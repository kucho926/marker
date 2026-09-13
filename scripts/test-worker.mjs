import worker from "../worker/index.js";

const rows = new Map(), changes = [];
const DB = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async run() {
        if (sql.startsWith("INSERT INTO assignments")) {
          const [id,title,question_count,types_json,salt,owner_hash,hashes_json,current_answers_json,attempt_count,created_at] = values;
          rows.set(id,{id,title,question_count,types_json,salt,owner_hash,hashes_json,current_answers_json,attempt_count,created_at,used_at:null,results_json:null});
          return {meta:{changes:1}};
        }
        if (sql.startsWith("UPDATE assignments")) {
          const [used_at,current_answers_json,results_json,attempt_count,id,expectedAttempt] = values;
          const row=rows.get(id);
          if (!row || row.attempt_count!==expectedAttempt) return {meta:{changes:0}};
          Object.assign(row,{used_at,current_answers_json,results_json,attempt_count});
          return {meta:{changes:1}};
        }
        if (sql.startsWith("INSERT INTO answer_changes")) {
          const [assignment_id,question_index,attempt_number,previous_answer,new_answer,is_correct,changed_at] = values;
          changes.push({assignment_id,question_index,attempt_number,previous_answer,new_answer,is_correct,changed_at,id:changes.length+1});
          return {meta:{changes:1}};
        }
      },
      async first() {
        const row=rows.get(values[0]);
        if (!row) return null;
        const fields=sql.match(/^SELECT (.+) FROM/)?.[1].split(",") || [];
        return Object.fromEntries(fields.map(f=>[f.trim(),row[f.trim()]]));
      },
      async all() {
        return {results:changes.filter(c=>c.assignment_id===values[0]).sort((a,b)=>a.id-b.id)};
      }
    };
  },
  async batch(statements) { return Promise.all(statements.map(s=>s.run())); }
};
const call=(path,init={})=>worker.fetch(new Request("https://test.local"+path,init),{DB});
const made=await (await call("/api/sets",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:"test",questions:[{type:"short",answer:"별 | 항성"},{type:"choice",answer:"3"}]})})).json();
const code=new URL(made.friend_url).searchParams.get("set");
const adminValue=new URL(made.admin_url).searchParams.get("admin");
if(!code || !adminValue) throw new Error("link creation failed");
const before=await (await call("/api/sets/"+code)).json();
if(before.types.join(",")!=="short,choice" || "hashes" in before || "owner_hash" in before) throw new Error("public set leaked or malformed");
const first=await (await call("/api/sets/"+code+"/check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({answers:["항 성","2"]})})).json();
if(JSON.stringify(first.results)!=="[true,false]" || first.currentAnswers[1]!=="2") throw new Error("first grading mismatch");
const second=await (await call("/api/sets/"+code+"/check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({answers:["","3"]})})).json();
if(JSON.stringify(second.results)!=="[true,true]") throw new Error("correction grading mismatch");
const dot=adminValue.indexOf("."),id=adminValue.slice(0,dot),token=adminValue.slice(dot+1);
const admin=await (await call("/api/admin/"+id+"?token="+encodeURIComponent(token))).json();
if(admin.changes.length!==1 || admin.changes[0].from!=="2" || admin.changes[0].to!=="3") throw new Error("admin history mismatch");
const denied=await call("/api/admin/"+id+"?token=wrong");
if(denied.status!==404) throw new Error("admin secret not enforced");
console.log("Correction flow and private history valid");
