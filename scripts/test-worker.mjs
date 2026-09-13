import worker from "../worker/index.js";

const rows = new Map();
const DB = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async run() {
        if (sql.startsWith("INSERT")) {
          const [id,title,question_count,types_json,salt,hashes_json,created_at] = values;
          rows.set(id,{id,title,question_count,types_json,salt,hashes_json,created_at,used_at:null,results_json:null});
          return {meta:{changes:1}};
        }
        if (sql.startsWith("UPDATE")) {
          const [used_at,results_json,id] = values;
          const row=rows.get(id);
          if (!row || row.used_at) return {meta:{changes:0}};
          Object.assign(row,{used_at,results_json});
          return {meta:{changes:1}};
        }
      },
      async first() {
        const row=rows.get(values[0]);
        if (!row) return null;
        const fields=sql.match(/^SELECT (.+) FROM/)?.[1].split(",") || [];
        return Object.fromEntries(fields.map(f=>[f.trim(),row[f.trim()]]));
      }
    };
  }
};
const call=(path,init={})=>worker.fetch(new Request("https://test.local"+path,init),{DB});
const made=await (await call("/api/sets",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:"test",questions:[{type:"short",answer:"별 | 항성"},{type:"choice",answer:"3"}]})})).json();
const code=new URL(made.url).searchParams.get("set");
if(!code) throw new Error("set creation failed");
const before=await (await call("/api/sets/"+code)).json();
if(before.types.join(",")!=="short,choice" || "hashes" in before) throw new Error("public set leaked or malformed");
const checked=await (await call("/api/sets/"+code+"/check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({answers:["항 성","2"]})})).json();
if(JSON.stringify(checked.results)!=="[true,false]") throw new Error("grading mismatch");
const repeated=await (await call("/api/sets/"+code+"/check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({answers:["wrong","3"]})})).json();
if(JSON.stringify(repeated.results)!=="[true,false]" || !repeated.already_submitted) throw new Error("one-attempt lock failed");
console.log("API flow valid; keys remain server-side");
