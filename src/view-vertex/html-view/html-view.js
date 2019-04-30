import { BOOLEAN } from "../../def"
import { stream, combine, keyF, sync } from "air-stream"
import {routeNormalizer, routeToString, signature} from "../../utils"
import events from "../events"
import JSON5 from "json5"
import { LiveSchema } from "../../live-schema"
import resource from "../../loader/resource"
import { NODE_TYPES } from "./def"
import Layer from "./layer"
import PlaceHolderContainer from "./place-holder-container"
import ActiveNodeTarget from "./active-node-target"
import { ModelVertex } from "../../model-vertex"

let UNIQUE_VIEW_KEY = 0;


class Cached {

	constructor({ constructor }) {
		this.__cache = [];
		this.constructor = constructor;
	}

	createIfNotExist( signature, data ) {
		let exist = this.__cache.find( ({ signature: x }) => signature === x );
		if(!exist) {
			exist = { signature, cell: this.constructor(signature, data) };
			this.__cache.push(exist);
		}
		return exist.cell;
	}

}

export default class HTMLView extends LiveSchema {
	
	constructor( args, src, { acid, createEntity = null } = {} ) {
		super( args, src, { acid } );
		createEntity && (this.createEntity = createEntity);
		this.prop.preload = this.prop.preload !== undefined ? this.prop.preload : true;
		this.prop.stream = this.prop.stream || "";
		this.prop.handlers = this.prop.handlers || [];
		this.prop.tee = this.prop.tee || null;
		this.prop.keyframes = this.prop.keyframes || [];
		this.prop.node = this.prop.node || document.createDocumentFragment();
		this.traits = [];
	}

	createActiveNodeTarget(node, resources) {
		return new ActiveNodeTarget(node, resources);
	}

	createKitLayer( { $: { modelschema,
		layers: layers = new Map( [ [ -1, { layer: modelschema, vars: {} } ] ] ) },
		signature: parentContainerSignature = null,
		...args
	} ) {
		
		function equal(prop, sign, letter) {
			if(!prop.length) {
				return Object.keys(sign).every( key => sign[key] === letter[key] )
			}
			throw "not supported yet"
		}
		
		function removeElementFromArray(arr, elem) {
			const indexOf = arr.indexOf(elem);
			if(indexOf === -1) {
				throw "element not found";
			}
			return arr.splice(indexOf, 1)[0];
		}
		
		return stream( ( emt, { sweep, over }) => {
			
			const container = new PlaceHolderContainer( this, { type: "kit" } );
			
			emt( [ {
				stage: 1,
				container,
				target: container.target,
				acids: this.layers.map( ({ acid }) => acid ),
			} ] );

			//todo need layers sup
			const modelvertex = layers.get(this.acid) || layers.get(-1);
			const modelstream = modelvertex.layer.obtain("", modelvertex.vars);
			
			const cache = new Cached( {
				constructor: (signature, data) => {

					const modelvertex = new ModelVertex(["$", { source: () => modelstream.map(([data]) => {
						const res = data.find( (obj) => Object.keys(signature)
							.every( key => signature[key] === obj[key]) )
						return res || [];
					}) }]);

					modelvertex.parent = (layers.get(this.acid) || layers.get(-1)).layer;

					layers = new Map([ ...layers, [this.acid, { layer: modelvertex, vars: {} } ]]);

					//todo need refactor
					if(this.layers.some( ({ prop: { tee } }) => tee ) || !this.prop.preload) {
						return this.createTeeEntity( { $: { layers },
							signature: {...signature, $: parentContainerSignature },
							...args
						} );
					}
					else {
						return this.createNextLayers( { $: { layers },
							signature: {...signature, $: parentContainerSignature },
							...args
						} );
					}
					
				}
			} );
			
			over.add(() => cache.clear());

			const store = [];
			
			sweep.add(modelstream.at( ([ childs, { action = "default" } = {} ]) => {

				//if(action === "default") {

					let domTreePlacment = container.begin;
					
					const deleted = [ ...store];

					childs.map( (signature, index) => {

						const exist = store.find( ({ signature: $ }) => equal([], signature, $ ) );
						if(!exist) {
							const box = new PlaceHolderContainer(this, { type: "item" });
							domTreePlacment.after(box.target);
							domTreePlacment = box.end;
							cache.createIfNotExist( signature )
								.at( ([ { stage, container: { target } } ]) => {
									if(stage === 1) {
										box.append( target );
									}
								});
							store.push( { signature, box } );
						}
						else {
							removeElementFromArray(deleted, exist);
							domTreePlacment.after(exist.box.target);
							domTreePlacment = exist.box.end;
						}

					} );
					
					deleted.map( ({ box, signature: $ }) => {
						const deleted = store.findIndex( ({ signature, box }) => equal([], signature, $));
						store.splice(deleted, 1);
						box.remove();
					} );

				//}

			} ));


		} );

	}

	createEntity( { $: { modelschema,
		layers: layers = new Map( [ [ -1, { layer: modelschema, vars: {} } ] ] ) }, ...args
	} ) {
		return stream( (emt, { sweep, over }) => {
			let state = { stage: 0, target: null, active: false };
			const clayers = new Map(this.layers.map(
				({ acid: _acid, src: { acid }, prop: { stream } }, i, arr) => {
					if(stream[0] === "^") {
						const eLayer =
							arr.slice(0, i).find( ({ prop: { stream } }) => stream[0] !== "^" );
						if(!eLayer) {
							throw `the first view layer cannot refer to the predecessor stream`
						}
						const { src: { acid }, prop: { stream: pstream } } = eLayer;
						
						//stream inheritance
						if(pstream === "" && !stream.substr(1)) {
							return [ _acid, {
								layer: layers.get(acid).layer.get(""),
								vars: layers.get(acid).vars,
							}];
						}
						
						return [_acid, {
							layer: layers.get(acid).layer.get( pstream + stream.substr(1) ),
							vars: routeNormalizer(pstream + stream.substr(1)),
						}];
					}
					if(stream === "") {
						return [ _acid, {
							layer: layers.get(acid).layer.get(stream),
							vars: layers.get(acid).vars,
						}];
					}
					else {
						return [_acid, {
							layer: (layers.get(acid) || [...layers][0][1] ).layer.get(stream),
							vars: routeNormalizer(stream),
						}];
					}
				}
			));
			sweep.add( combine(
				[...clayers].map( ([, { layer } ]) => layer ),
				(...layers) => new Map([ ...clayers].map( ([ acid, { vars: { route, ...vars } } ], i) => [
					acid, { layer: layers[i], vars }
				] ))
			).at( ( layers ) => {
				
				/*
				if(this.layers.some( ({ prop: { tee } }) => tee ) || !this.prop.preload) {
					over.add(this.createTeeEntity( { $: { layers }, ...args } ).on(emt));
				}
				else {
					over.add(this.createNextLayers( { $: { layers }, ...args } ).on(emt));
				}
				*/
				
				if(this.layers.some( ({ prop: { kit } }) => kit )) {
					over.add(this.createKitLayer( { $: { layers }, ...args } ).on(emt));
				}
				else {
					//todo need refactor
					if(this.layers.some( ({ prop: { tee } }) => tee ) || !this.prop.preload) {
						over.add(this.createTeeEntity( { $: { layers }, ...args } ).on(emt));
					}
					else {
						over.add(this.createNextLayers( { $: { layers }, ...args } ).on(emt));
					}
				}
				
			} ) );
		} );
	}
	
	acidis(name) {
		return (this.acid+"").indexOf(name) > -1;
	}

	createLayer(owner, { targets, resources }, args ) {
		return new Layer( this, owner, { targets, resources }, args );
	}

	createNextLayers( { $: { layers }, ...args } ) {
		return stream( (emt, { sweep, over }) => {

			const container = new PlaceHolderContainer(this, { type: "layers" });

			let actives = [];
			let state = {
				acids: this.layers.map( ({ acid }) => acid ),
				acid: this.acid,
				stage: 0, container, 
				key: this.key, 
				target: container.target
			};
			
			sweep.add( () => actives.map( x => x.clear() ) );

			sweep.add( combine( [
				...this.layers.map( (layer) =>
					layer.createNodeEntity( { $: { container, layers }, ...args } )
				),
				this.createChildrenEntity( { $: { container, layers }, ...args } ),
			] ).at( (comps) => {
				const children = comps.pop();
				container.append(...comps.map( ({ container: { target } }) => target));
				const slots = container.slots();

				if(children.length) {
					if(slots.length) {



						//if(_slots.size !== children.length) debugger;

						children.map( ([{ target, acids }]) => {

							const place = slots
								.filter( ({ acid }) => acids.includes(acid) )
								.reduce(( exist, {slot, acid} ) => {
								//const acid = slot.getAttribute("acid");

								if(!exist) {
									exist = slot;
									//cache.set(acid, slot);
								}
								else if(
									exist.parentNode.nodeType !== NODE_TYPES.ELEMENT_NODE &&
									slot.parentNode.nodeType === NODE_TYPES.ELEMENT_NODE
								) {
									exist.remove();
									exist = slot;
									//cache.set(acid, slot);
								}
								else {
									slot.remove();
								}
								return exist;
							}, null);


							place.replaceWith( target );
						} );
						
					}
					else {
						container.append( ...children.map( ( [{ target }] ) => target ) );
					}
				}
				over.add(sync(this.layers.map(
					( layer, i ) => layer.createLayer(
						{ schema: { model: layers.get(layer.acid) } },
						{ resources: comps[i].resources,
							targets: [
								...comps[i].container.targets( "datas", comps[i].resources ),
								...container.targets("actives", comps[i].resources )
							],
						},
						args
					).stream),
					([{ stage: a }], [{ stage: b }]) => a === b,
					( ...layers ) => [ { ...state, stage: layers[0][0].stage } ]
				)
					.on( emt )
				);
			}) );
		} );
	}

	createNodeEntity( ) {
		return stream( (emt, { sweep }) => {
			sweep.add(combine( this.prop.resources ).at( ( resources ) => {
				const container = new PlaceHolderContainer( this, { type: "node" } );
				container.append(this.prop.node.cloneNode(true));
				const imgs = resources.filter(({type}) => type === "img");
				[...container.target.querySelectorAll(`slot[img]`)]
					.map((target, i) => target.replaceWith(imgs[i].image));
				emt.kf();
				emt( { resources, container } );
			}));
		});
	}

	teeSignatureCheck( layers ) {
		return this.layers.every( ({ acid, prop: { tee } }) => signature( tee, layers.get(acid) ) );
	}

	createTeeEntity( { $: { layers }, ...args } ) {

		const teeLayers = this.layers
			.filter( ({ prop: { tee } }) => tee )
			.map( ({ acid }) => acid );

		const teeStreamLayers = new Map([...layers].filter( ([acid]) => teeLayers.includes(acid) ));



		//выбрать те слои с данными, в которых присутсвует tee
		const modelschema = combine(
			[...teeStreamLayers].map( ([, { layer, vars } ]) => layer.obtain("", vars) ),
			(...layers) => layers.map( ly => Array.isArray(ly) ? ly[0] : ly )
		);

		return stream( (emt, { sweep, hook }) => {

			let state = {
				acids: this.layers.map( ({ acid }) => acid ),
				acid: this.acid, key: this.key, stage: 0, active: false, target: null
			};
			let reqState = { stage: 1 };
			let loaderTarget = null;
			let loaderHook = null;
			let childHook = null;
			let loaderContainer = null;

			const container = new PlaceHolderContainer( this, { type: "entity" } );
			state.target = container.target;
			state.container = container;

			//todo temporary solution
			
			/*if(!this.prop.preload) {
				sweep.add( loaderHook = this.obtain( "#loader", { $: { layers } } )
					.at( ([ { stage, container: inner, target } ]) => {
						if(state.stage === 0 && stage > 0) {
							loaderContainer = inner;
							loaderTarget = target;
							state = { ...state, load: true, stage: 1, };
							container.append( target );
							emt.kf();
							emt( [ state ] );
						}
					} )
				);
			}*/

			let _inner = null;
			const view = this.createNextLayers( { $: { layers }, ...args } );
			sweep.add( modelschema.at( (data) => {
				const connect = () => {
					sweep.add( childHook = view
						.connectable( (data) => {
							if(data !== keyF) {
								if(state.load) {
									state = { ...state, load: false };
									loaderContainer.restore();
								}
								const [ { stage, target, container: inner } ] = data;
								_inner = inner;
								if(state.stage === 0) {
									state = { ...state, stage: 1 };
									emt.kf();
									emt( [ state ] );
								}
								if( stage === 1 ) {
									if(state.active) {
										childHook({action: "fade-in"});
										container.begin.after( _inner.target );
									}
									else {
										_inner && _inner.restore();
										if(!this.prop.preload) {
											childHook && sweep.force( childHook );
											childHook = null;
										}
									}
								}
							}
						} )
					);
					childHook.connect();
				};

				const active = this.teeSignatureCheck(
					new Map([ ...teeStreamLayers ].map( ([ acid ], i) => [acid, data[i]]) )
				);

				if(!active && !this.prop.preload) {
					//loaderContainer loaderContainer.restore();
					state = { ...state, stage: 1 };
					emt.kf();
					emt( [ state ] );
				}

				if(state.stage === 0) {
					if(this.prop.preload) {
						connect();
					}
				}

				if(active !== state.active) {
					state = { ...state, active };
					if(active) {
						if(!childHook) {
							connect();
						}
						else {
							if(state.stage === 1) {
								childHook({action: "fade-in"});
								container.begin.after( _inner.target );
							}
						}
					}
					else {
						if(childHook) {
							childHook({action: "fade-out"});
						}
					}
				}
			} ) );

		});
	}

	createChildrenEntity( { $: { container: { target, begin }, layers }, ...args } ) {
		return combine( this.item
			.filter( ({ prop: { template } }) => !template )
			.map(x => x.obtain( "", { $: { layers }, ...args } ))
		);
	}
	
	parse(node, src, { pack } ) {
		return this.constructor.parse( node, src, { pack } );
	}
	
	static parse( node, src, { pack, type = "unit" } ) {

		let uvk = `${++UNIQUE_VIEW_KEY}`;
		
		if(!(node instanceof Element)) {
			return new HTMLView( ["", {}], src, { createEntity: node } );
		}

		const { path = "./", key: pkey = uvk } = (src || {}).prop || {};

		let key = node.getAttribute("key");
		
		if(key !== null) {
			if(/[`"'{}\]\[]/.test(key)) {
				key = JSON5.parse(key);
			}
			uvk = key;
		}
		else {
			key = pkey;
		}
		
		const handlers = [ ...node.attributes ]
			.filter( ({ name }) => events.includes(name) )
			.map( ({ name, value }) => ({
				name: name.replace(/^on/, ""),
				hn: new Function("event", "options", "request", "key", "signature", "req", value )
			}) );
		
		let stream = node.getAttribute("stream");
		stream = stream && routeNormalizer(stream.toString()) || { route: [] };
		stream.route = stream.route.map( seg => seg === "$key" ? key : seg );
		Object.keys( stream ).map( prop => stream[prop] === "$key" && (stream[prop] = key) );
		stream = routeToString(stream);

		const acid = node.getAttribute("acid") || "";

		const template = ["", "true"].includes(node.getAttribute("template"));
		const id = node.getAttribute("id") || "$";

		const use = pathParser( node.getAttribute("use") || "" );

        const resources =
            [ ...(src.acid !== -1 && src.prop.resources || []), ...JSON5
                .parse(node.getAttribute("resources") || "[]")
                .map( x => resource(pack, x) )
            ];

        const style = node.querySelectorAll("* > style");

        if(style.length) {
			resources.push(...[...style].map( style => {
				style.remove();
				return resource(pack, { type: "inline-style", style })
			} ));
		}
		
        const tee = cuttee(node, key);
		const kit = cutkit(node, key);
        const preload = !["", "true"].includes(node.getAttribute("nopreload"));
        
		const keyframes = [];

		const prop = {
			kit,            //kit's container
            tee,            //switch mode
            preload,        //must be fully loaded before readiness
            pack,           //current package
			keyframes,      //animation ( data ) settings
			use,            //reused templates path
			template,       //template node
			id,             //tree m2 advantages id
			type,           //view node type [node -> unit, switcher -> tee]
			//source,         //m2 advantages source path if module
			handlers,       //event handlers
			path,           //absolute path
			node,           //xml target node
			key,            //inherited or inner key
			stream,         //link to model stream todo obsolete io
			resources,      //related resources
		};

		const res = src.acid !== -1 && src.lift( [ uvk, prop ], src, { acid } ) ||
			new HTMLView( [ uvk, prop ], src, { acid } );
		
		//[...node.childNodes].map( next => setup( next, res.prop ));

		res.append(...[...node.children].reduce((acc, next) =>
				[...acc, ...parseChildren( next, res.prop, res )]
			, []));

		keyframes.push(...parseKeyFrames( { node } ));
		
		res.prop.node = document.createDocumentFragment();
		res.prop.node.append( ...node.childNodes );
		
		return res;
		
	}
	
	mergeProperties( name, value ) {
		if(name === "stream") {
			return this.prop.stream;
		}
		/*else if(name === "template") {
			return this.prop.template || value;
		}*/
		/*else if( name == "tee" ) {
			return [ ...this.prop.tee, ...value];
		}*/
		else if([
			"kit",
			"preload",
			"key",
			"tee",
			"template",
			"handlers",
			"keyframes",
			"node",
			"pack",
			"source"
		].includes(name)) {
			return this.prop[name];
		}
		else {
			return super.mergeProperties( name, value );
		}
	}
	
}

function pathSplitter(str = "") {
	str = str + ",";
	let mode = 0;
	let prev = 0;
	const res = [];
	for(let i = 0; i < str.length; i++ ) {
		if(str[i] === "{") {
			mode++;
		}
		else if(str[i] === "}") {
			mode--;
		}
		else if(str[i] === ",") {
			if(mode === 0) {
				res.push( str.substring(prev, i) );
				prev = i+1;
			}
		}
	}
	return res;
}

function pathParser(str) {
	return pathSplitter(str)
		.map( (ly)=>{
			ly = ly.trim();
			if(!ly) {
				return null;
			}
			else {
				let [ , path = null ] = ly.match( /^url\((.*)\)$/ ) || [];
				if(path) {
					return { path, type: "url", schtype: "html" };
				}
				else {
					return { path: ly, type: "query", schtype: "html" };
				}
			}
		} )
		.filter( Boolean )
}

const REG_GETTER_ATTRIBUTE = /\(([a-zA-Z_]{1}[\[\]\.a-zA-Z\-_0-9]*?)\)/g;


function parseKeyProps( { classList, ...prop } ) {
	if(classList) {
		return {
			classList: Object.keys(classList).reduce( (acc, next) => {
				if(next.indexOf("|") > - 1) {
					next.split("|").reduce( (acc, name) => {
						acc[name] = classList[next] === name;
						return acc;
					}, acc);
				}
				else {
					acc[next] = !!classList[next];
				}
				return acc;
			}, {} ),
			...prop,
		}
	}
	return {
		...prop,
	}
}

function parseKeyFrames( { node } ) {
	let res = [];
	const keyframe = node.querySelectorAll("keyframe");
	if(keyframe.length) {
		res = [...keyframe].map( node => {
			const action = node.getAttribute("name") || "default";
			let prop = (node.getAttribute("prop"));
			if(prop) {
				prop = prop.replace(REG_GETTER_ATTRIBUTE, (_, reg) => {
					return `(argv.${reg})`;
				});
				prop = new Function("argv", "ttm", `return ${prop}`);
			}
			const keys = [...node.querySelectorAll("key")]
				.map( node => {
					let prop = null;
					let offset = node.getAttribute("offset");
					let properties = node.getAttribute("prop");
					if(properties) {
						const functionBuilder = properties.replace(REG_GETTER_ATTRIBUTE, (_, reg) => {
							return `(argv.${reg})`;
						});
						const handler = new Function("argv", "ttm", `return ${functionBuilder}`);
						prop = (argv) => parseKeyProps(handler(argv));
					}
					return [ offset, prop ];
				} );
			node.remove();
			return [ action, prop, ...keys ];
		} );
	}
	return res;
}

function cuttee(node, key) {
	let rawTee = node.getAttribute("tee");
	if(rawTee === null) {
		return null;
	}
	else if(rawTee === "") {
		return key;
	}
	else if(rawTee[0] === "{") {

		//autocomplete { value } boolean
		rawTee = rawTee.replace(/\{\s*([a-zA-Z0-9]+|\"[\-\!\&\$\?\*a-zA-Z0-9]+\")\s*\}/g, (_, vl) => {
			return "{" +  vl + ":$bool" + "}"
		});

		return new Function("$bool", "return" + rawTee)(BOOLEAN);

		return JSON5.parse(rawTee);
	}
	else {
		return rawTee;
	}
}

function cutkit(node, key) {
	const raw = node.getAttribute("kit");
	if(raw === null) {
		return null;
	}
	else if(raw === "") {
		return true;
	}
	else
		return raw
}

function slot( { key, acid } ) {
	const res = document.createElement("slot");
	res.setAttribute("acid", acid);
	return res;
}

function img() {
	const res = document.createElement("slot");
	res.setAttribute("img", "");
	return res;
}

/**
 *
 * @param node
 * @param {String} name
 * @returns {boolean}
 */
function is( node, name ) {
	name = name.toUpperCase();
	return [ `M2-${name}`, name ].includes( node.tagName );
}

//the workaround is tied to the querySelectorAll,
// since it is used to extract replacement slots
function parseChildren(next, { resources, path, key }, src) {
	if(is( next, "unit" )) {
		const parser = HTMLView.parse(next, src, { pack: src.prop.pack });
		const _slot = slot( parser );
		parser.prop.template ? next.remove() : next.replaceWith( _slot );
		return [ parser ];
	}
	else if(is( next, "plug" )) {
		const parser = HTMLView.parse(next, src, {
			key, path, type: "custom", pack: src.prop.pack
		});
		const _slot = slot( parser );
		parser.prop.template ? next.remove() : next.replaceWith( _slot );
		return [ parser ];
	}
	else if (next.tagName === "IMG") {
		const _slot = img( );
		next.replaceWith( _slot );
		resources.push(
			resource(src.prop.pack, { type: "img", url: next.getAttribute("src") })
		);
		return [];
	}
	else if(next.tagName === "STYLE") { }
	return [...next.children].reduce( (acc, node) =>
			[...acc, ...parseChildren(node, { resources, path, key }, src)]
		, []);
}