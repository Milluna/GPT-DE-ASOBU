import assert from 'node:assert/strict';

const base='http://127.0.0.1:8787';
const create=await fetch(`${base}/api/rooms`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
assert.equal(create.status,201);
const host=await create.json();
assert.match(host.roomCode,/^\d{5}$/);
const join=await fetch(`${base}/api/rooms/${host.roomCode}/join`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
assert.equal(join.status,200);
const guest=await join.json();

function connect(session){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(`ws://127.0.0.1:8787/ws/${session.roomCode}?token=${session.token}`);
    const timer=setTimeout(()=>reject(new Error('socket timeout')),5000);
    ws.addEventListener('open',()=>{clearTimeout(timer);resolve(ws)},{once:true});
    ws.addEventListener('error',()=>reject(new Error('socket error')),{once:true});
  });
}
function waitMessage(ws,predicate,label){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.removeEventListener('message',onMessage);reject(new Error(`message timeout: ${label}`));},5000);
    const onMessage=(event)=>{
      const data=JSON.parse(String(event.data));
      if(!predicate(data)) return;
      clearTimeout(timer);ws.removeEventListener('message',onMessage);resolve(data);
    };
    ws.addEventListener('message',onMessage);
  });
}
const hostWelcomeP = (async()=>{const ws=await connect(host); return {ws,welcome:await waitMessage(ws,m=>m.type==='welcome','host welcome')}})();
const {ws:hostWs,welcome:hostWelcome}=await hostWelcomeP;
assert.equal(hostWelcome.role,'host');
const hostSeesGuest = waitMessage(hostWs,m=>m.type==='presence'&&m.presence.guest===true,'host sees guest');
const guestWs=await connect(guest);
const guestWelcome=await waitMessage(guestWs,m=>m.type==='welcome','guest welcome');
assert.equal(guestWelcome.role,'guest');
const presence=await hostSeesGuest;
assert.equal(presence.presence.host,true);

const state={x:1.25,z:-0.5,yaw:0.7,speed:4.1,motion:'start-left',motionSequence:9,clientTime:123};
const stateReceived=waitMessage(guestWs,m=>m.type==='state'&&m.state?.motionSequence===9,'state relay');
hostWs.send(JSON.stringify({type:'state',state}));
assert.deepEqual((await stateReceived).state,state);

const bubbleReceived=waitMessage(hostWs,m=>m.type==='bubble'&&m.text==='ぐるぐる〜','bubble relay');
guestWs.send(JSON.stringify({type:'bubble',text:'ぐるぐる〜',sequence:7}));
const bubble=await bubbleReceived;
assert.equal(bubble.role,'guest');
assert.equal(bubble.sequence,7);

hostWs.close(1000,'done'); guestWs.close(1000,'done');
console.log(JSON.stringify({roomCode:host.roomCode,hostWelcome,guestWelcome,bubble},null,2));
