import worker from "../worker/index.js";
import page from "../worker/page.js";

if (!page.includes('이름과 PIN') || !page.includes('새 문제지는 여기에 계속 쌓입니다') || !page.includes('관리자 로그인')) throw new Error('account UI missing');
if (!page.includes('온라인 문제 파일') || !page.includes('정답이나 해설이 보이지 않는 것')) throw new Error('safe worksheet upload UI missing');
if (page.includes('?set=') || page.includes('친구용 채점 링크')) throw new Error('legacy multi-link UI remains');

const DB={prepare(){return{bind(){return this},async first(){return null},async all(){return{results:[]}},async run(){return{meta:{changes:1}}}}},async batch(){return[]}};
const root=await worker.fetch(new Request('https://test.local/'),{DB,ADMIN_PIN:'1234'});
if(root.status!==200 || !(await root.text()).includes('내 문제지'))throw new Error('page route failed');
const denied=await worker.fetch(new Request('https://test.local/api/me'),{DB,ADMIN_PIN:'1234'});
if(denied.status!==401)throw new Error('student auth not enforced');
const wrong=await worker.fetch(new Request('https://test.local/api/login/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:'9999'})}),{DB,ADMIN_PIN:'1234'});
if(wrong.status!==403)throw new Error('admin PIN not enforced');
const options=await worker.fetch(new Request('https://test.local/api/me',{method:'OPTIONS'}),{DB,ADMIN_PIN:'1234'});
if(options.status!==204 || !options.headers.get('access-control-allow-headers').includes('authorization'))throw new Error('CORS auth header missing');
console.log('Account, single-link, and authorization checks valid');
