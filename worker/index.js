import page from "./page.js";

const corsHeaders={"access-control-allow-origin":"https://kucho926.github.io","access-control-allow-methods":"GET, POST, PUT, DELETE, OPTIONS","access-control-allow-headers":"content-type, authorization"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...corsHeaders}});
const bytesToUrl=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
const random=n=>bytesToUrl(crypto.getRandomValues(new Uint8Array(n)));
const normalizeAnswer=s=>String(s??"").normalize("NFKC").trim().toLowerCase().replace(/\s+/g,"");
const normalizeName=s=>String(s??"").normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
async function digest(value){return bytesToUrl(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value)))))}
const answerHash=(salt,value)=>digest(salt+":"+normalizeAnswer(value));
const secretHash=(salt,value)=>digest(salt+":"+String(value));
const parse=(value,fallback)=>{try{return JSON.parse(value)??fallback}catch{return fallback}};

async function createSession(env,role,userId=null){const token=random(32),now=new Date(),expires=new Date(now.getTime()+90*86400000).toISOString();await env.DB.prepare("INSERT INTO app_sessions (token_hash,user_id,role,expires_at,created_at) VALUES (?,?,?,?,?)").bind(await digest(token),userId,role,expires,now.toISOString()).run();return token}
async function session(request,env,needed){const value=request.headers.get("authorization")||"";if(!value.startsWith("Bearer "))return null;const token=value.slice(7);if(!token)return null;const row=await env.DB.prepare("SELECT s.user_id,s.role,s.expires_at,u.display_name FROM app_sessions s LEFT JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=?").bind(await digest(token)).first();if(!row||row.role!==needed||row.expires_at<=new Date().toISOString())return null;return {userId:row.user_id,role:row.role,name:row.display_name}}
async function requireSession(request,env,role){const s=await session(request,env,role);return s||json({error:"unauthorized"},401)}

async function loginStudent(request,env,signup=false){
 const raw=await request.text();if(raw.length>3000)return json({error:"invalid_login"},400);
 const body=parse(raw,null);if(!body)return json({error:"invalid_login"},400);
 const displayName=String(body.name||"").normalize("NFKC").trim().replace(/\s+/g," "),name=normalizeName(displayName),pin=String(body.pin||"");
 if(!name||displayName.length>30||pin.length<4||pin.length>20)return json({error:"invalid_login"},400);
 if(signup&&pin!==body.confirmPin)return json({error:"pin_mismatch"},400);
 let user=await env.DB.prepare("SELECT id,display_name,pin_salt,pin_hash FROM app_users WHERE normalized_name=?").bind(name).first();
 if(signup){
  if(user)return json({error:"name_taken"},409);
  const id=random(16),salt=random(16);
  try{await env.DB.prepare("INSERT INTO app_users (id,display_name,normalized_name,pin_salt,pin_hash,created_at) VALUES (?,?,?,?,?,?)").bind(id,displayName,name,salt,await secretHash(salt,pin),new Date().toISOString()).run();}
  catch(e){if(await env.DB.prepare("SELECT id FROM app_users WHERE normalized_name=?").bind(name).first())return json({error:"name_taken"},409);throw e;}
  return json({ok:true},201);
 }
 if(!user)return json({error:"account_not_found"},404);
 if(await secretHash(user.pin_salt,pin)!==user.pin_hash)return json({error:"wrong_pin"},403);
 return json({token:await createSession(env,"student",user.id),role:"student",user:{name:user.display_name}});
}

async function loginAdmin(request,env){const body=await request.json(),pin=String(body.pin||"");if(!env.ADMIN_PIN||pin.length<4||await digest(pin)!==await digest(env.ADMIN_PIN))return json({error:"wrong_pin"},403);return json({token:await createSession(env,"admin"),role:"admin"})}

async function studentHome(request,env){const s=await requireSession(request,env,"student");if(s instanceof Response)return s;const data=await env.DB.prepare("SELECT a.id,a.title,a.question_count,a.created_at,p.results_json,p.attempt_count,p.completed_at FROM assignments a LEFT JOIN assignment_progress p ON p.assignment_id=a.id AND p.user_id=? WHERE a.is_active=1 ORDER BY a.created_at DESC").bind(s.userId).all();return json({user:{name:s.name},assignments:(data.results||[]).map(a=>({id:a.id,title:a.title,questionCount:a.question_count,createdAt:a.created_at,results:parse(a.results_json,[]),attemptCount:Number(a.attempt_count||0),completedAt:a.completed_at||null}))})}
async function getAssignment(id,request,env){const s=await requireSession(request,env,"student");if(s instanceof Response)return s;const row=await env.DB.prepare("SELECT a.id,a.title,a.question_count,a.types_json,a.salt,a.hashes_json,a.worksheet_key,a.worksheet_name,a.worksheet_type,p.current_answers_json,p.results_json,p.attempt_count,p.completed_at FROM assignments a LEFT JOIN assignment_progress p ON p.assignment_id=a.id AND p.user_id=? WHERE a.id=? AND a.is_active=1").bind(s.userId,id).first();if(!row)return json({error:"not_found"},404);const answers=parse(row.current_answers_json,Array(row.question_count).fill("")),results=await evaluateAnswers(answers,row);const draftData=await readDraft(id,s.userId,row,Number(row.attempt_count||0),env);if(draftData.draft)draftData.draft.answers=draftData.draft.answers.map((a,i)=>results[i]?"":a);return json({...draftData,revision:await digest(row.salt),id:row.id,title:row.title,questionCount:row.question_count,types:parse(row.types_json,[]),hasWorksheet:!!row.worksheet_key,worksheetName:row.worksheet_name||null,worksheetType:row.worksheet_type||null,worksheetUrl:row.worksheet_key?"/worksheet/"+encodeURIComponent(row.id):null,currentAnswers:answers.map((a,i)=>results[i]?"":a),results,attemptCount:Number(row.attempt_count||0),completedAt:row.completed_at||null})}
async function checkAssignment(id,request,env){const s=await requireSession(request,env,"student");if(s instanceof Response)return s;if(Number(request.headers.get("content-length")||0)>12000)return json({error:"too_large"},413);const body=await request.json(),submitted=Array.isArray(body.answers)?body.answers.map(x=>String(x).slice(0,200)):[];const set=await env.DB.prepare("SELECT id,question_count,salt,hashes_json FROM assignments WHERE id=? AND is_active=1").bind(id).first();if(!set)return json({error:"not_found"},404);if(body.revision&&body.revision!==await digest(set.salt))return json({error:"key_changed"},409);if(submitted.length!==set.question_count)return json({error:"invalid_answers"},400);const now=new Date().toISOString();await env.DB.prepare("INSERT OR IGNORE INTO assignment_progress (assignment_id,user_id,current_answers_json,results_json,attempt_count,updated_at) VALUES (?,?,?,?,?,?)").bind(id,s.userId,JSON.stringify(Array(set.question_count).fill("")),JSON.stringify(Array(set.question_count).fill(false)),0,now).run();const old=await env.DB.prepare("SELECT current_answers_json,results_json,attempt_count,started_at,completed_at FROM assignment_progress WHERE assignment_id=? AND user_id=?").bind(id,s.userId).first();if(!old)return json({error:"try_again"},409);if(body.attemptCount!==undefined&&body.attemptCount!==Number(old.attempt_count||0))return json({error:"try_again"},409);const previous=parse(old.current_answers_json,Array(set.question_count).fill("")),oldResults=await evaluateAnswers(previous,set),answers=submitted.map((a,i)=>oldResults[i]?previous[i]:a);if(answers.some((x,i)=>!oldResults[i]&&!normalizeAnswer(x)))return json({error:"missing_answer"},400);const expected=parse(set.hashes_json,[]),results=[];for(let i=0;i<answers.length;i++)results.push(oldResults[i]||expected[i]?.includes(await answerHash(set.salt,answers[i]))||false);const attempt=Number(old.attempt_count||0)+1,complete=results.every(Boolean)?(old.completed_at||now):null;const saved=await env.DB.prepare("UPDATE assignment_progress SET current_answers_json=?,results_json=?,attempt_count=?,started_at=?,updated_at=?,completed_at=? WHERE assignment_id=? AND user_id=? AND attempt_count=? AND EXISTS (SELECT 1 FROM assignments WHERE id=? AND salt=?)").bind(JSON.stringify(answers),JSON.stringify(results),attempt,old.started_at||now,now,complete,id,s.userId,Number(old.attempt_count||0),id,set.salt).run();if(!saved.meta?.changes)return json({error:"try_again"},409);if(Number(old.attempt_count||0)>0){const changes=[];for(let i=0;i<answers.length;i++){if(!oldResults[i]&&normalizeAnswer(previous[i])!==normalizeAnswer(answers[i]))changes.push(env.DB.prepare("INSERT INTO answer_changes (assignment_id,user_id,question_index,attempt_number,previous_answer,new_answer,is_correct,changed_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,s.userId,i,attempt,previous[i],answers[i],results[i]?1:0,now))}if(changes.length)await env.DB.batch(changes)}return json({revision:await digest(set.salt),currentAnswers:answers.map((a,i)=>results[i]?"":a),results,attemptCount:attempt,completedAt:complete})}



const draftKey=(user,id)=>"drafts/"+encodeURIComponent(user)+"/"+encodeURIComponent(id)+".json";
async function saveDraft(id,request,env){
 const auth=await requireSession(request,env,"student");if(auth instanceof Response)return auth;
 const raw=await request.text();if(raw.length>20000)return json({error:"too_large"},413);const body=parse(raw,null);
 const row=await env.DB.prepare("SELECT a.salt,a.question_count,p.attempt_count FROM assignments a LEFT JOIN assignment_progress p ON p.assignment_id=a.id AND p.user_id=? WHERE a.id=? AND a.is_active=1").bind(auth.userId,id).first();
 if(!row)return json({error:"not_found"},404);
 if(!body||!Array.isArray(body.answers)||body.answers.length!==row.question_count||body.answers.some(a=>typeof a!=="string"||a.length>200))return json({error:"invalid_answers"},400);
 if(body.revision!==await digest(row.salt)||body.attemptCount!==Number(row.attempt_count||0))return json({error:"draft_stale"},409);
 const savedAt=new Date().toISOString(),item={answers:body.answers,revision:body.revision,attemptCount:body.attemptCount,savedAt};
 const saved=await env.FILES.put(draftKey(auth.userId,id),JSON.stringify(item),{onlyIf:typeof body.version==="string"&&body.version?{etagMatches:body.version}:{etagDoesNotMatch:"*"},httpMetadata:{contentType:"application/json"}});
 return saved?json({ok:true,version:saved.etag,savedAt}):json({error:"draft_conflict"},409);
}
async function readDraft(id,user,set,attempt,env){
 const obj=await env.FILES.get(draftKey(user,id));if(!obj)return {draft:null,draftVersion:null};
 const item=await obj.json(),valid=item.revision===await digest(set.salt)&&item.attemptCount===attempt&&Array.isArray(item.answers)&&item.answers.length===set.question_count;
 return {draft:valid?item:null,draftVersion:obj.etag};
}

async function evaluateAnswers(answers,set){const hashes=parse(set.hashes_json,[]);return Promise.all(Array.from({length:set.question_count},async(_,i)=>!!normalizeAnswer(answers[i])&&!!hashes[i]?.includes(await answerHash(set.salt,answers[i]))))}
async function regradeProgress(id,env,set){
 const data=await env.DB.prepare("SELECT user_id,current_answers_json,attempt_count,completed_at FROM assignment_progress WHERE assignment_id=?").bind(id).all();
 const now=new Date().toISOString();let count=0;
 for(const p of data.results||[]){const results=await evaluateAnswers(parse(p.current_answers_json,[]),set),complete=p.attempt_count>0&&results.every(Boolean)?p.completed_at||now:null;
 const saved=await env.DB.prepare("UPDATE assignment_progress SET results_json=?,completed_at=?,updated_at=? WHERE assignment_id=? AND user_id=? AND current_answers_json=? AND attempt_count=? AND EXISTS (SELECT 1 FROM assignments WHERE id=? AND salt=?)").bind(JSON.stringify(results),complete,now,id,p.user_id,p.current_answers_json,p.attempt_count,id,set.salt).run();count+=Number(saved.meta?.changes||0);}
 return count;
}

async function makeHashes(questions,salt){const hashes=[];for(const q of questions){const variants=String(q.answer).split("|").map(x=>x.trim()).filter(Boolean).slice(0,8);hashes.push(await Promise.all(variants.map(v=>answerHash(salt,v))))}return hashes}
function validQuestions(body){const qs=Array.isArray(body.questions)?body.questions:[];if(qs.length<1||qs.length>40||qs.some(q=>!q||!String(q.answer||"").trim()))return null;const questions=qs.map(q=>({type:q.type==="choice"?"choice":"short",answer:String(q.answer).slice(0,300).trim()}));for(const q of questions){if(q.type==="choice"){const options=q.answer.normalize("NFKC").split("|").map(x=>x.trim());if(options.some(x=>!["1","2","3","4","5"].includes(x)))return null;q.answer=options.join("|")}}return questions}
async function createAssignment(request,env){const s=await requireSession(request,env,"admin");if(s instanceof Response)return s;const body=await request.json(),questions=validQuestions(body);if(!questions)return json({error:"invalid_questions"},400);const id=random(18),salt=random(16),title=String(body.title||"오늘의 문제").trim().slice(0,80)||"오늘의 문제",types=questions.map(q=>q.type),now=new Date().toISOString();await env.DB.prepare("INSERT INTO assignments (id,title,question_count,types_json,salt,owner_hash,hashes_json,current_answers_json,attempt_count,answer_keys_json,is_active,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,title,questions.length,JSON.stringify(types),salt,"",JSON.stringify(await makeHashes(questions,salt)),"[]",0,JSON.stringify(questions),body.isActive===false?0:1,now,now).run();return json({id},201)}
async function updateAssignment(id,request,env){
 const auth=await requireSession(request,env,"admin");if(auth instanceof Response)return auth;
 const body=await request.json(),row=await env.DB.prepare("SELECT id,title,answer_keys_json,is_active,salt,question_count,types_json FROM assignments WHERE id=?").bind(id).first();if(!row)return json({error:"not_found"},404);
 const title=body.title===undefined?row.title:(String(body.title).trim().slice(0,80)||row.title),active=body.isActive===undefined?Number(row.is_active):body.isActive?1:0,now=new Date().toISOString();
 if(body.questions===undefined){await env.DB.prepare("UPDATE assignments SET title=?,is_active=?,updated_at=? WHERE id=?").bind(title,active,now,id).run();return json({ok:true})}
 const questions=validQuestions(body);if(!questions)return json({error:"invalid_questions"},400);
 const changed=JSON.stringify(questions)!==JSON.stringify(parse(row.answer_keys_json,[]));
 const types=questions.map(q=>q.type);
 if(changed&&(questions.length!==row.question_count))return json({error:"structure_locked"},409);
 const salt=changed?random(16):row.salt,hashes=await makeHashes(questions,salt);
 const saved=await env.DB.prepare("UPDATE assignments SET title=?,question_count=?,types_json=?,salt=?,hashes_json=?,answer_keys_json=?,is_active=?,updated_at=? WHERE id=? AND salt=?").bind(title,questions.length,JSON.stringify(types),salt,JSON.stringify(hashes),JSON.stringify(questions),active,now,id,row.salt).run();
 if(!saved.meta?.changes)return json({error:"try_again"},409);
 const count=await regradeProgress(id,env,{salt,hashes_json:JSON.stringify(hashes),question_count:questions.length});
 return json({ok:true,regraded:changed,regradedCount:count});
}
async function deleteAssignment(id,request,env){
 const auth=await requireSession(request,env,"admin");if(auth instanceof Response)return auth;
 const row=await env.DB.prepare("SELECT id,worksheet_key FROM assignments WHERE id=?").bind(id).first();if(!row)return json({error:"not_found"},404);
 await env.DB.batch([
  env.DB.prepare("DELETE FROM answer_changes WHERE assignment_id=?").bind(id),
  env.DB.prepare("DELETE FROM assignment_progress WHERE assignment_id=?").bind(id),
  env.DB.prepare("DELETE FROM assignments WHERE id=?").bind(id)
 ]);
 let cleanupIncomplete=false;
 try{
  const users=await env.DB.prepare("SELECT id FROM app_users").all();
  for(const user of users.results||[]){
   const prefix="questions/"+encodeURIComponent(user.id)+"/"+encodeURIComponent(id)+"/";
   for(;;){const page=await env.FILES.list({prefix,limit:1000});if(!page.objects.length)break;await Promise.all(page.objects.map(o=>env.FILES.delete(o.key)));}
   await env.FILES.delete(draftKey(user.id,id));
  }
  if(row.worksheet_key)await env.FILES.delete(row.worksheet_key);
 }catch(e){console.error("Worksheet attachment cleanup failed",e);cleanupIncomplete=true}
 return json({ok:true,cleanupIncomplete});
}
async function adminDashboard(request,env){const s=await requireSession(request,env,"admin");if(s instanceof Response)return s;const sets=await env.DB.prepare("SELECT a.id,a.title,a.question_count,a.answer_keys_json,a.worksheet_key,a.worksheet_name,a.worksheet_type,a.is_active,a.created_at,COUNT(CASE WHEN p.attempt_count>0 THEN 1 END) AS student_count,COUNT(CASE WHEN p.completed_at IS NOT NULL THEN 1 END) AS completed_count FROM assignments a LEFT JOIN assignment_progress p ON p.assignment_id=a.id GROUP BY a.id ORDER BY a.created_at DESC").all();const changes=await env.DB.prepare("SELECT c.question_index,c.previous_answer,c.new_answer,c.is_correct,c.changed_at,u.display_name,a.title FROM answer_changes c LEFT JOIN app_users u ON u.id=c.user_id LEFT JOIN assignments a ON a.id=c.assignment_id WHERE c.user_id IS NOT NULL ORDER BY c.id DESC LIMIT 300").all();return json({assignments:(sets.results||[]).map(a=>({id:a.id,title:a.title,questionCount:a.question_count,questions:parse(a.answer_keys_json,[]),hasWorksheet:!!a.worksheet_key,worksheetName:a.worksheet_name||null,worksheetType:a.worksheet_type||null,isActive:!!a.is_active,studentCount:Number(a.student_count||0),completedCount:Number(a.completed_count||0),createdAt:a.created_at})),changes:(changes.results||[]).map(c=>({studentName:c.display_name||"알 수 없음",assignmentTitle:c.title,question:c.question_index+1,from:c.previous_answer,to:c.new_answer,correct:!!c.is_correct,at:c.changed_at}))})}

async function uploadWorksheet(id,request,env){const s=await requireSession(request,env,"admin");if(s instanceof Response)return s;if(Number(request.headers.get("content-length")||0)>16*1024*1024)return json({error:"too_large"},413);const row=await env.DB.prepare("SELECT worksheet_key FROM assignments WHERE id=?").bind(id).first();if(!row)return json({error:"not_found"},404);const form=await request.formData(),file=form.get("file");if(form.get("confirmed")!=="yes")return json({error:"confirmation_required"},400);if(!(file instanceof File)||!file.size)return json({error:"missing_file"},400);const allowed=["application/pdf","image/jpeg","image/png","image/webp"];if(!allowed.includes(file.type)||file.size>15*1024*1024)return json({error:"invalid_file"},400);const ext={"application/pdf":"pdf","image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[file.type],key="worksheets/"+id+"/"+random(12)+"."+ext;await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type},customMetadata:{originalName:String(file.name||"worksheet").slice(0,180)}});const updated=await env.DB.prepare("UPDATE assignments SET worksheet_key=?,worksheet_name=?,worksheet_type=?,updated_at=? WHERE id=?").bind(key,String(file.name||"문제지").slice(0,180),file.type,new Date().toISOString(),id).run();if(!updated.meta?.changes){await env.FILES.delete(key);return json({error:"save_failed"},500)}if(row.worksheet_key&&row.worksheet_key!==key)await env.FILES.delete(row.worksheet_key);return json({ok:true,worksheetUrl:"/worksheet/"+encodeURIComponent(id)})}
async function serveWorksheet(id,env){const row=await env.DB.prepare("SELECT worksheet_key,worksheet_name,worksheet_type FROM assignments WHERE id=? AND is_active=1").bind(id).first();if(!row?.worksheet_key)return new Response("문제지를 찾을 수 없습니다.",{status:404,headers:{"content-type":"text/plain; charset=utf-8"}});const object=await env.FILES.get(row.worksheet_key);if(!object)return new Response("문제지를 찾을 수 없습니다.",{status:404,headers:{"content-type":"text/plain; charset=utf-8"}});const safeName=String(row.worksheet_name||"worksheet").replace(/[\r\n"]/g,"");return new Response(object.body,{headers:{"content-type":row.worksheet_type||object.httpMetadata?.contentType||"application/octet-stream","content-disposition":`inline; filename*=UTF-8''${encodeURIComponent(safeName)}`,"cache-control":"private, max-age=300","x-content-type-options":"nosniff"}})}



async function saveQuestion(request,env){
 const auth=await requireSession(request,env,"student");if(auth instanceof Response)return auth;
 const raw=await request.text();if(raw.length>2000)return json({error:"too_large"},413);
 const body=parse(raw,null);if(!body||typeof body.assignmentId!=="string"||!Number.isInteger(body.question)||body.page!==undefined&&(!Number.isInteger(body.page)||body.page<1||body.page>9999))return json({error:"invalid_question"},400);
 const row=await env.DB.prepare("SELECT id,title,question_count FROM assignments WHERE id=? AND is_active=1").bind(body.assignmentId).first();
 if(!row)return json({error:"not_found"},404);if(body.question<1||body.question>row.question_count)return json({error:"invalid_question"},400);
 const key="questions/"+encodeURIComponent(auth.userId)+"/"+encodeURIComponent(row.id)+"/"+body.question+".json";
 const object=await env.FILES.get(key),old=object?await object.json():null;
 if(old&&old.status!=="resolved"){
  if(body.page===undefined||body.page===old.page)return json({ok:true,alreadyExists:true});
  const changed=await env.FILES.put(key,JSON.stringify({...old,page:body.page,updatedAt:new Date().toISOString()}),{onlyIf:{etagMatches:object.etag},httpMetadata:{contentType:"application/json"}});
  return changed?json({ok:true,alreadyExists:true,pageUpdated:true}):json({error:"try_again"},409);
 }
 const now=new Date().toISOString(),item={studentName:auth.name,assignmentTitle:row.title,assignmentId:row.id,question:body.question,page:body.page??old?.page??null,createdAt:old?.createdAt||now,updatedAt:now,status:"open",requestCount:(old?.requestCount|| (old?1:0))+1,history:[...(old?.history||[]),{action:old?"reopened":"asked",at:now}]};
 const saved=await env.FILES.put(key,JSON.stringify(item),{onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:"*"},httpMetadata:{contentType:"application/json"}});
 if(!saved)return json({error:"try_again"},409);
 return json({ok:true,reopened:!!old},201);
}
async function resolveQuestion(request,env){
 const auth=await requireSession(request,env,"admin");if(auth instanceof Response)return auth;
 const body=await request.json(),key=body.key;
 if(typeof key!=="string"||!/^questions\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[0-9]+\.json$/.test(key)||typeof body.version!=="string")return json({error:"invalid_question"},400);
 const obj=await env.FILES.get(key);if(!obj)return json({error:"not_found"},404);
 if(obj.etag!==body.version)return json({error:"try_again"},409);
 const old=await obj.json();if(old.status==="resolved")return json({ok:true});
 const now=new Date().toISOString(),saved=await env.FILES.put(key,JSON.stringify({...old,status:"resolved",updatedAt:now,resolvedAt:now,history:[...(old.history||[]),{action:"resolved",at:now}]}),{onlyIf:{etagMatches:obj.etag},httpMetadata:{contentType:"application/json"}});
 return saved?json({ok:true}):json({error:"try_again"},409);
}
async function deleteQuestion(request,env){
 const auth=await session(request,env,"admin")||await session(request,env,"student");if(!auth)return json({error:"unauthorized"},401);
 const body=await request.json(),key=body?.key;
 if(typeof key!=="string"||!/^questions\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[0-9]+\.json$/.test(key)||typeof body.version!=="string")return json({error:"invalid_question"},400);
 if(auth.role==="student"&&!key.startsWith("questions/"+encodeURIComponent(auth.userId)+"/"))return json({error:"forbidden"},403);
 const obj=await env.FILES.get(key);if(!obj)return json({error:"not_found"},404);
 if(obj.etag!==body.version)return json({error:"try_again"},409);
 await env.FILES.delete(key);return json({ok:true});
}
async function listQuestions(request,env){
 const auth=await session(request,env,"admin")||await session(request,env,"student");if(!auth)return json({error:"unauthorized"},401);
 const url=new URL(request.url),requested=url.searchParams.get("status"),query=(url.searchParams.get("q")||"").trim().toLocaleLowerCase("ko");
 if(requested!==null&&!(["open","resolved"].includes(requested))||query.length>80)return json({error:"invalid_filter"},400);
 let cursor=url.searchParams.get("cursor")||undefined;if(cursor&&cursor.length>4096)return json({error:"invalid_cursor"},400);
 const prefix=auth.role==="admin"?"questions/":"questions/"+encodeURIComponent(auth.userId)+"/",items=[];
 const existing=await env.DB.prepare("SELECT id FROM assignments").all(),assignmentIds=new Set((existing.results||[]).map(a=>a.id));
 // Keep the legacy unfiltered endpoint working. Filtered views scan in bounded chunks,
 // then continue from the R2 cursor so old resolved questions never hide new open ones.
 const maxPages=requested!==null||query?20:1;
 for(let scan=0;scan<maxPages;scan++){
  const page=await env.FILES.list({prefix,limit:50,cursor});
  const found=await Promise.all(page.objects.map(async o=>{const obj=await env.FILES.get(o.key);if(!obj)return null;const q=await obj.json();if(!assignmentIds.has(q.assignmentId||decodeURIComponent(o.key.split("/")[2])))return null;if(requested&&((q.status||"open")==="resolved"?"resolved":"open")!==requested)return null;
   if(query){const fields=[q.assignmentTitle,q.studentName,String(q.page||"")+"페이지",String(q.question||"")+"번"];if(!fields.some(v=>String(v||"").toLocaleLowerCase("ko").includes(query)))return null}
   return {key:o.key,version:obj.etag,studentName:q.studentName,assignmentTitle:q.assignmentTitle,assignmentId:q.assignmentId||decodeURIComponent(o.key.split("/")[2]),question:q.question,page:Number.isInteger(q.page)?q.page:null,createdAt:q.createdAt,updatedAt:q.updatedAt||q.createdAt,status:q.status||"open",requestCount:q.requestCount||1};
  }));
  items.push(...found.filter(Boolean));
  cursor=page.truncated?page.cursor:null;
  if(!cursor||items.length>=50)break;
 }
 return json({questions:items,cursor:cursor||null});
}

const sessionKey="settings/next-session.json";
async function getStudySession(request,env){
 const auth=await session(request,env,"admin")||await session(request,env,"student");if(!auth)return json({error:"unauthorized"},401);
 const obj=await env.FILES.get(sessionKey);if(!obj)return json({startsAt:null,version:null});
 const data=await obj.json();return json({startsAt:data.startsAt||null,version:obj.etag});
}
async function saveStudySession(request,env){
 const auth=await requireSession(request,env,"admin");if(auth instanceof Response)return auth;
 const body=await request.json(),startsAt=body?.startsAt;
 if(!body||typeof startsAt!=="string"||!Object.hasOwn(body,"version")||body.version!==null&&typeof body.version!=="string")return json({error:"invalid_session"},400);
 if(startsAt){
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(startsAt);
  if(!m||+m[2]<1||+m[2]>12||+m[3]<1||+m[3]>new Date(+m[1],+m[2],0).getDate()||+m[4]>23||+m[5]>59)return json({error:"invalid_session"},400);
 }
 const old=await env.FILES.get(sessionKey);
 if((old?.etag||null)!==body.version)return json({error:"try_again"},409);
 const saved=await env.FILES.put(sessionKey,JSON.stringify({startsAt:startsAt||null,updatedAt:new Date().toISOString()}),{onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:"*"},httpMetadata:{contentType:"application/json"}});
 return saved?json({ok:true,version:saved.etag}):json({error:"try_again"},409);
}

export default{async fetch(request,env){try{const u=new URL(request.url),path=u.pathname;if(request.method==="OPTIONS"&&path.startsWith("/api/"))return new Response(null,{status:204,headers:corsHeaders});if(request.method==="GET"&&path==="/")return new Response(page,{headers:{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: https://baro-grade.hrs251714.chatgpt.site; frame-src 'self' https://baro-grade.hrs251714.chatgpt.site; connect-src 'self' https://baro-grade.hrs251714.chatgpt.site; frame-ancestors 'none'","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});if(request.method==="DELETE"&&path==="/api/questions")return deleteQuestion(request,env);if(request.method==="PUT"&&path==="/api/questions/resolve")return resolveQuestion(request,env);if(request.method==="PUT"&&path==="/api/study-session")return saveStudySession(request,env);if(request.method==="POST"&&path==="/api/questions")return saveQuestion(request,env);if(request.method==="GET"&&path==="/api/questions")return listQuestions(request,env);if(request.method==="GET"&&path==="/api/study-session")return getStudySession(request,env);let dm=path.match(/^\/api\/assignments\/([^/]+)\/draft$/);if(request.method==="PUT"&&dm)return saveDraft(decodeURIComponent(dm[1]),request,env);let m=path.match(/^\/worksheet\/([^/]+)$/);if(request.method==="GET"&&m)return serveWorksheet(decodeURIComponent(m[1]),env);if(request.method==="POST"&&path==="/api/signup/student")return loginStudent(request,env,true);if(request.method==="POST"&&path==="/api/login/student")return loginStudent(request,env);if(request.method==="POST"&&path==="/api/login/admin")return loginAdmin(request,env);if(request.method==="GET"&&path==="/api/me")return studentHome(request,env);if(request.method==="GET"&&path==="/api/admin/dashboard")return adminDashboard(request,env);if(request.method==="POST"&&path==="/api/admin/assignments")return createAssignment(request,env);m=path.match(/^\/api\/admin\/assignments\/([^/]+)\/worksheet$/);if(request.method==="POST"&&m)return uploadWorksheet(decodeURIComponent(m[1]),request,env);m=path.match(/^\/api\/admin\/assignments\/([^/]+)$/);if(request.method==="PUT"&&m)return updateAssignment(decodeURIComponent(m[1]),request,env);if(request.method==="DELETE"&&m)return deleteAssignment(decodeURIComponent(m[1]),request,env);m=path.match(/^\/api\/assignments\/([^/]+)$/);if(request.method==="GET"&&m)return getAssignment(decodeURIComponent(m[1]),request,env);m=path.match(/^\/api\/assignments\/([^/]+)\/check$/);if(request.method==="POST"&&m)return checkAssignment(decodeURIComponent(m[1]),request,env);return json({error:"not_found"},404)}catch(e){console.error(e);return json({error:"server_error"},500)}}};
