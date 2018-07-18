export default function ({path}) {
    if(/.\.js$/g.test(path)) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = path;
            script.addEventListener("load", resolve);
            script.addEventListener("error", reject);
            document.head.appendChild(script);
        });
    }
    else if(/.\.json$/g.test(path)) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", path, true);
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.setRequestHeader('Content-type', 'application/json; charset=utf-8');
            xhr.onload = () => {
                resolve( {module: {default: JSON.parse(xhr.responseText)}} );
            };
            xhr.send();
        });
    }
    else if (/.\.html/g.test(path)) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", path, true);
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.setRequestHeader('Content-type', 'application/json; charset=utf-8');
            xhr.onload = () => {
                const doc = new DOMParser().parseFromString(xhr.responseText, "application/xml");
                const err = doc.querySelector("parsererror");
                if(err) throw `${path} parser error: ${err.innerText}`;
                const res = transform(doc.firstChild);
                resolve( {module: {default: res}} );
            };
            xhr.send();
        });
    }
}

let pid = 0;
function transform( node ) {
    const [ name, { source, template = false, ...props } = {} ] = JSON.parse(node.getAttribute("data-m2"));
    pid++;
    const handlers = [...node.attributes]
        .filter(({name}) => ["onpointermove", "onclick"].includes(name))
        .filter(({value}) => value )
        .map( ({ name, nodeValue }) => ({ name: name.replace(/^on/, ""), hn: new Function("event", "schema", "action", nodeValue) }) );
    handlers.map( ({name}) => node.removeAttribute(name) );
    const m2data = [ name, { handlers, source, template, node, ...props, pid } ];
    node.setAttribute("data-m2", JSON.stringify([ name, { source, ...props } ]));
    vertextes( node, m2data, true );
    return m2data;
}

//todo need refactor
function vertextes(node, exist = []) {
    return [...node.children].reduce( (acc, node) => {
        if(node.tagName === "img") {
            //const [ name, props = {} ] = JSON.parse(node.getAttribute("data-m2") || "[]");
            node.setAttribute("data-m2", JSON.stringify([
                "*", { resources: [ {type: "img", url: node.getAttribute("src") } ]}])
            );
        }
        if(node.getAttribute("data-m2")) {
            const m2data = transform(node);
            if(!m2data[1].template && m2data[1].type !== "switcher") {
                const placer = document.createElement("div");
                placer.setAttribute("data-pid", m2data[1].pid );
                node.parentNode.replaceChild(placer, node);
            }
            node.remove();
            acc.push( m2data );
        }
        else {
            vertextes(node, exist);
        }
        return acc;
    }, exist);
}