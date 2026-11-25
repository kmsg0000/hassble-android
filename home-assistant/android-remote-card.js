const apps = { "유튜브": "vnd.youtube://", "넷플릭스": "netflix://" };
const spokenKeys = [
  [/^(볼륨|음량|소리)(을)?(올려|높여|키워)(줘)?$/, "VOLUME_UP"],
  [/^(볼륨|음량|소리)(을)?(내려|낮춰|줄여)(줘)?$/, "VOLUME_DOWN"],
  [/^음소거(해줘)?$/, "VOLUME_MUTE"], [/^홈(으로)?$/, "HOME"],
  [/^뒤로(가기)?$/, "BACK"], [/^일시정지$/, "MEDIA_PAUSE"], [/^재생$/, "MEDIA_PLAY"]
];
function interpret(text) {
  const compact = text.replace(/[\s.!?]/g, "");
  for (const app of Object.keys(apps)) {
    if (new RegExp("^"+app+"(열어|실행해|켜|틀어|실행)?(줘)?$").test(compact)) return { app };
    const match = text.match(new RegExp("^"+app+"에서\\s*(.+?)\\s*검색(?:해\\s*줘|해|하기)?[.!?]?$"));
    if (match) return { app, query: match[1].trim() };
  }
  for (const [pattern,key] of spokenKeys) if (pattern.test(compact)) return {key};
  return {query:text};
}

class AndroidRemoteCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity?.startsWith("remote.")) throw Error("안방 TV의 remote 엔티티 ID를 입력하세요.");
    if(this.entity!==config.entity) this.endSession();
    this.entity=config.entity;this.pipeline=config.pipeline;
    if(this.shadowRoot)return;
    const root=this.attachShadow({mode:"open"});
    root.innerHTML=`<style>
    :host{display:block}ha-card{padding:20px;background:#282e30;color:#f5f5ed;border-radius:24px;font-family:inherit}
    header,section,form{display:flex;gap:8px;align-items:center}header{justify-content:space-between;margin-bottom:16px}h2{font-size:20px;margin:0}small{color:#ccd3ca}
    button,input{font:inherit;border:0;border-radius:13px;box-sizing:border-box}button{min-height:44px;padding:8px 12px;cursor:pointer;background:#454c4d;color:white;touch-action:manipulation}button:active{filter:brightness(.8)}button:disabled{opacity:.5}
    section button{flex:1}.apps button{font-size:18px;font-weight:750;user-select:none}.apps button:first-child{color:#ff6477;background:#181b1b}.apps button:last-child{background:#f7f2e8;color:#202321}.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:248px;margin:14px auto}.ok,.voice{background:#cfeaa0;color:#223019;font-weight:700}.pad button:first-child{grid-column:2}.pad button:nth-child(2){grid-column:1}.pad button:last-child{grid-column:2}section{margin-top:7px}.voice{width:100%;margin-top:12px}input{width:0;flex:1;min-height:44px;padding:10px;background:#f8faf3;color:#252b26}form{margin-top:12px}p{margin:10px 0 0;font-size:13px;line-height:1.5}</style>
    <ha-card><header><div><h2>안드로이드 리모컨</h2><small></small></div><button data-key="POWER">전원</button></header>
    <section class="apps"><button data-app="넷플릭스">NETFLIX</button><button data-app="유튜브">▶ YouTube</button></section>
    <div class="pad"><button data-key="DPAD_UP" aria-label="위">⌃</button><button data-key="DPAD_LEFT" aria-label="왼쪽">‹</button><button class="ok" data-key="DPAD_CENTER">확인</button><button data-key="DPAD_RIGHT" aria-label="오른쪽">›</button><button data-key="DPAD_DOWN" aria-label="아래">⌄</button></div>
    <section><button data-key="BACK">뒤로</button><button data-key="HOME">홈</button><button data-key="MEDIA_PLAY_PAUSE">재생·정지</button></section>
    <section><button data-key="VOLUME_DOWN">음량 −</button><button data-key="VOLUME_MUTE">음소거</button><button data-key="VOLUME_UP">음량 +</button></section>
    <button class="voice">음성 명령</button><form><input aria-label="TV 검색어" placeholder="TV에 보낼 검색어"><button>보내기</button></form><p role="status">앱 버튼을 길게 누르면 음성으로 검색어를 입력합니다.</p></ha-card>`;
    root.querySelectorAll("[data-key]").forEach(b=>b.onclick=()=>this.act("send_command",{command:b.dataset.key}));
    root.querySelectorAll("[data-app]").forEach(b=>{
      let timer,held=false;
      b.onpointerdown=()=>{held=false;timer=setTimeout(()=>{held=true;this.listen(b.dataset.app)},500)};
      b.onpointercancel=b.onpointerleave=b.onpointerup=()=>clearTimeout(timer);
      b.oncontextmenu=e=>e.preventDefault();
      b.onclick=()=>{if(!held)this.launch(b.dataset.app);held=false};
    });
    this.el(".voice").onclick=()=>this.session?this.stopAudio(this.session):this.listen();
    this.el("form").onsubmit=async e=>{e.preventDefault();const input=this.el("input"),value=input.value.trim();if(value&&await this.act("send_command",{command:"text:"+value}))this.say("검색어를 보냈습니다.");};
  }
  el(s){return this.shadowRoot.querySelector(s)}
  say(text){this.el("p").textContent=text}
  set hass(hass){this.ha=hass;if(!this.shadowRoot)return;const tv=hass.states[this.entity];this.el("small").textContent=tv?(tv.attributes.friendly_name||this.entity)+(tv.state==="unavailable"?" · 연결 끊김":""):"TV 엔티티를 확인하세요";}
  async act(service,data){try{await this.ha.callService("remote",service,{entity_id:this.entity,...data});return true}catch(e){this.say(e.message||"TV 명령 전송 실패");return false}}
  launch(app){return this.act("turn_on",{activity:apps[app]})}
  async recognized(text,app){
    const action=app?{query:text}:interpret(text);
    if(action.app && !await this.launch(action.app))return;
    if(action.key){await this.act("send_command",{command:action.key});return}
    if(action.query){this.el("input").value=action.query;this.say("TV에서 검색 입력칸을 선택한 뒤 보내기를 누르세요.")}
    else this.say(text);
  }
  stopAudio(s){
    if(s.ended)return;s.ended=true;
    if(s.id!=null&&s.socket?.readyState===1)s.socket.send(new Uint8Array([s.id]));
    s.stream?.getTracks().forEach(t=>t.stop());s.node?.disconnect();s.source?.disconnect();
    if(s.ctx&&s.ctx.state!=="closed")s.ctx.close().catch(()=>{});
    if(this.session===s){this.el(".voice").textContent="음성 처리 중…";this.el(".voice").disabled=true;}
  }
  endSession(){
    const s=this.session;if(!s)return;this.session=null;clearTimeout(s.limit);clearTimeout(s.timeout);this.stopAudio(s);
    if(s.unsubscribe)s.unsubscribe().catch(()=>{});
    this.el(".voice").disabled=false;this.el(".voice").textContent="음성 명령";
  }
  disconnectedCallback(){this.endSession()}
  async listen(app){
    if(this.session)return;const s={};this.session=s;
    this.el(".voice").disabled=true;this.say("마이크 연결 중…");
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error("마이크를 쓰려면 HTTPS로 HA에 접속하세요. 검색칸의 키보드 음성 입력도 사용할 수 있습니다.");
      const ctx=new AudioContext({sampleRate:16000});s.ctx=ctx;await ctx.resume();
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true}});
      if(this.session!==s){stream.getTracks().forEach(t=>t.stop());return}
      s.stream=stream;
      if(app && !await this.launch(app)){this.endSession();return}
      const con=this.ha.connection;s.socket=con.socket;
      s.source=ctx.createMediaStreamSource(stream);s.node=ctx.createScriptProcessor(2048,1,1);
      s.node.onaudioprocess=e=>{
        if(s.id==null||s.ended||s.socket.readyState!==1)return;
        const audio=e.inputBuffer.getChannelData(0),packet=new Uint8Array(1+audio.length*2),view=new DataView(packet.buffer);packet[0]=s.id;
        for(let i=0;i<audio.length;i++)view.setInt16(1+i*2,Math.round(Math.max(-1,Math.min(1,audio[i]))*32767),true);
        s.socket.send(packet);
      };
      const msg={type:"assist_pipeline/run",start_stage:"stt",end_stage:"stt",input:{sample_rate:ctx.sampleRate}};
      if(this.pipeline)msg.pipeline=this.pipeline;
      s.timeout=setTimeout(()=>{if(this.session===s){this.endSession();this.say("음성 인식 응답 시간이 초과됐습니다.")}},30000);
      const unsub=await con.subscribeMessage(ev=>{
        if(this.session!==s)return;
        if(ev.type==="run-start")s.id=ev.data.runner_data.stt_binary_handler_id;
        if(ev.type==="stt-start"){s.source.connect(s.node);s.node.connect(ctx.destination);this.el(".voice").textContent="말하기 완료";this.el(".voice").disabled=false;this.say(app?"검색할 제목을 말하세요.":"예: 유튜브 열어 줘, 볼륨 올려 줘");s.limit=setTimeout(()=>this.stopAudio(s),10000);}
        if(ev.type==="stt-end"){const t=ev.data.stt_output?.text?.trim();this.endSession();if(t)this.recognized(t,app);else this.say("다시 말해 주세요.");}
        if(ev.type==="error"||ev.type==="run-end"){this.endSession();this.say(ev.data?.message||"음성을 인식하지 못했습니다.");}
      },msg,{resubscribe:false});
      if(this.session===s)s.unsubscribe=unsub;else unsub().catch(()=>{});
    }catch(e){if(this.session===s){this.endSession();this.say(e.message||"마이크 권한과 HA 음성 도우미 설정을 확인하세요.")}}
  }
  getCardSize(){return 7}
}
if(!customElements.get("android-remote-card"))customElements.define("android-remote-card",AndroidRemoteCard);
