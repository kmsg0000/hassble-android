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
    const paths={
      power:"M12 2v9 M7 5a8 8 0 1 0 10 0",tv:"M3 5h18v12H3z M8 21h8",
      up:"m6 15 6-6 6 6",down:"m6 9 6 6 6-6",left:"m15 6-6 6 6 6",right:"m9 6 6 6-6 6",
      back:"m9 5-6 6 6 6 M4 11h10a6 6 0 0 1 6 6",home:"m3 11 9-8 9 8 M6 10v10h12V10",
      play:"m3 5 9 7-9 7z M16 6v12 M21 6v12",plus:"M12 5v14 M5 12h14",minus:"M5 12h14",
      mute:"M3 9h4l5-5v16l-5-5H3z M16 9l5 6 M21 9l-5 6",
      mic:"M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 11a7 7 0 0 0 14 0 M12 18v4 M9 22h6",
      keyboard:"M2 5h20v14H2z M6 9h1m3 0h1m3 0h1m3 0h.5 M7 15h10"};
    const icon=name=>`<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name]}"/></svg>`;
    const key=(code,name,glyph,extra="",label=false)=>`<button class="${extra}" data-key="${code}" aria-label="${name}">${icon(glyph)}${label?name:""}</button>`;
    root.innerHTML=`<style>
    :host{display:block;container-type:inline-size}*{box-sizing:border-box}ha-card{display:block;max-width:490px;margin:auto;overflow:hidden;background:#f5f3ec;color:#202d2b;border:1px solid #d7d8cd;border-radius:26px;font-family:Roboto,"Noto Sans KR",sans-serif}
    header,.line,.actions,form,.app,.tools,.nav,button{display:flex;align-items:center}header{padding:18px 20px;gap:12px;background:#e7eade;border-bottom:1px solid #ccd2c2}.tv{display:grid;place-items:center;background:#254b43;color:#e4f3b3;border-radius:13px;width:43px;height:43px;flex:none}.identity{flex:1;min-width:0}h2{font-size:21px;line-height:1.25;letter-spacing:-.8px;margin:0;color:#233732}.status{display:block;font-size:12px;color:#455d54;margin-top:3px}button,input{font:inherit}button{justify-content:center;cursor:pointer;touch-action:manipulation;user-select:none;border:0;min-height:44px;background:transparent;color:inherit;font-weight:650}button:focus-visible,input:focus-visible{outline:3px solid #c27424;outline-offset:-3px}button:active{filter:brightness(.88)}button:disabled{opacity:.65}
    svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round;flex:none;pointer-events:none}.power{border-radius:50%;background:#fafbf4;border:1px solid #cbd3c3;width:46px;height:46px}
    .body{padding:15px 16px}.actions{gap:8px}.app{flex:1;min-width:0;background:#202326;color:#ff5f6a;border-radius:14px;overflow:hidden}.app.youtube{background:white;color:#252726;border:1px solid #dddcd3}.open{height:49px;flex:1;min-width:0;font-size:17px;letter-spacing:-.6px;padding:0 4px}.netflix .open{font-family:Roboto,Arial,sans-serif;font-weight:900}.appmic{width:44px;flex:none;border-left:1px solid #ffffff32;color:#e1e2dd}.youtube .appmic{border-color:#deded8;color:#49514d}.appmic svg{width:17px}.youtube i{font:9px/14px sans-serif;background:#e82a2e;color:white;border-radius:4px;width:19px;text-align:center;margin-right:3px}
    .deck{margin-top:14px;background:linear-gradient(135deg,#294c44,#193b35 72%);border-radius:23px;padding:17px 12px 7px;color:#f7f8ef}.line{gap:clamp(12px,5cqw,25px);justify-content:center}.pad{position:relative;width:clamp(156px,55cqw,219px);aspect-ratio:1;border-radius:50%;background:linear-gradient(145deg,#567367,#34544b 72%);box-shadow:inset 0 1px 1px #89a194,0 3px 7px #102a2480}.pad button{position:absolute;border-radius:50%;width:31%;height:31%;min-height:0}.up{top:1%;left:34.5%}.down{bottom:1%;left:34.5%}.left{top:34.5%;left:1%}.right{top:34.5%;right:1%}.pad .center{width:37%;height:37%;top:31.5%;left:31.5%;color:#233a2e;font-size:17px;background:linear-gradient(145deg,#f0f5d5,#c7dbac);box-shadow:0 2px 5px #153a2c85}.rocker{width:54px;border-radius:26px;background:#16362f;overflow:hidden;text-align:center}.rocker button{width:100%;height:46px}.rocker small{color:#c3d4c7;font-size:11px}.rocker .mute{border-top:1px solid #446255}.rocker .mute svg{width:18px}
    .nav{margin-top:14px;border-top:1px solid #456359}.nav button{flex:1;gap:6px;height:48px;font-size:13px}.nav svg{width:19px}
    .tools{gap:8px;margin-top:12px}.voice{gap:9px;flex:1;border-radius:13px;color:#f8ffef;background:#325e50;height:47px}.keyboard{width:48px;border:1px solid #ced4c6;border-radius:13px;background:#fffef8}.keyboard svg{width:20px}
    form{gap:6px;margin-top:10px}form[hidden],p:empty{display:none}input{flex:1;width:0;min-height:44px;padding:0 9px;background:white;color:#24342b;border:1px solid #b7c5ba;border-radius:10px}form button{background:#e0e8d3;border-radius:10px;padding:0 13px}p{margin:9px 2px 0;color:#3d5148;font-size:12px;line-height:1.5}
    @container(max-width:310px){header{padding:12px}.body{padding:10px}.app .open{font-size:14px}.youtube i{display:none}.nav button{gap:3px;font-size:12px}}
    </style><ha-card><header><span class="tv">${icon("tv")}</span><div class="identity"><h2>안방 TV</h2><span class="status"></span></div>${key("POWER","전원","power","power")}</header>
    <div class="body"><div class="actions">${["넷플릭스","유튜브"].map((app,i)=>`<div class="app ${i?"youtube":"netflix"}"><button class="open" data-app="${app}" aria-label="${app} 열기">${i?"<i>▸</i>YouTube":"NETFLIX"}</button><button class="appmic" data-search="${app}" aria-label="${app} 음성 검색">${icon("mic")}</button></div>`).join("")}</div>
    <div class="deck"><div class="line"><div class="pad">${key("DPAD_UP","위","up","up")}${key("DPAD_LEFT","왼쪽","left","left")}<button class="center" data-key="DPAD_CENTER">확인</button>${key("DPAD_RIGHT","오른쪽","right","right")}${key("DPAD_DOWN","아래","down","down")}</div>
    <div class="rocker">${key("VOLUME_UP","음량 올리기","plus")}<small>음량</small>${key("VOLUME_DOWN","음량 내리기","minus")}${key("VOLUME_MUTE","음소거","mute","mute")}</div></div>
    <div class="nav">${key("BACK","뒤로","back","",true)}${key("HOME","홈","home","",true)}${key("MEDIA_PLAY_PAUSE","재생·정지","play","",true)}</div></div>
    <div class="tools"><button class="voice">${icon("mic")}<span>음성 명령</span></button><button class="keyboard" aria-label="검색어 입력" aria-expanded="false">${icon("keyboard")}</button></div>
    <form hidden><input aria-label="TV 검색어" placeholder="TV에 보낼 검색어"><button>보내기</button></form><p role="status"></p></div></ha-card>`;
    root.querySelectorAll("[data-search]").forEach(b=>b.onclick=()=>this.listen(b.dataset.search));
    this.el(".keyboard").onclick=()=>{this.searchTarget=null;this.voiceInputMode="query";this.el("form button").textContent="보내기";this.showInput(this.el("form").hidden,true);};
    root.querySelectorAll("[data-key]").forEach(b=>b.onclick=()=>this.act("send_command",{command:b.dataset.key}));
    root.querySelectorAll("[data-app]").forEach(b=>{
      let timer,held=false;
      b.onpointerdown=()=>{held=false;timer=setTimeout(()=>{held=true;this.listen(b.dataset.app)},500)};
      b.onpointercancel=b.onpointerleave=b.onpointerup=()=>clearTimeout(timer);
      b.oncontextmenu=e=>e.preventDefault();
      b.onclick=()=>{if(!held)this.launch(b.dataset.app);held=false};
    });
    this.el(".voice").onclick=()=>this.session?this.stopAudio(this.session):this.listen();
    this.el("form").onsubmit=async e=>{e.preventDefault();const input=this.el("input"),value=input.value.trim();if(value&&this.voiceInputMode==="command"){this.voiceInputMode="query";this.el("form button").textContent="보내기";await this.recognized(value);return;}if(value)await this.sendQuery(value,this.searchTarget);};
  }
  showInput(open,focus=false){this.el("form").hidden=!open;this.el(".keyboard").setAttribute("aria-expanded",String(open));if(open&&focus)this.el("input").focus()}
  el(s){return this.shadowRoot.querySelector(s)}
  say(text){this.el("p").textContent=text}
  set hass(hass){this.ha=hass;if(!this.shadowRoot)return;const tv=hass.states[this.entity];this.el("h2").textContent=tv?.attributes.friendly_name||this.entity;this.el(".status").textContent=!tv?"엔티티 확인 필요":({on:"TV 켜짐",off:"TV 꺼짐",unavailable:"연결 끊김",unknown:"상태 확인 중"}[tv.state]||tv.state);}
  async act(service,data){try{await this.ha.callService("remote",service,{entity_id:this.entity,...data});return true}catch(e){this.say(e.message||"TV 명령 전송 실패");return false}}
  launch(app){return this.act("turn_on",{activity:apps[app]})}
  async sendQuery(query,app){
    const youtube=app==="유튜브";
    const ok=youtube?await this.act("turn_on",{activity:"https://www.youtube.com/results?search_query="+encodeURIComponent(query)}):await this.act("send_command",{command:"text:"+query});
    if(ok)this.say(youtube?"유튜브에 검색 요청을 보냈습니다.":"TV 검색 입력칸에 문자 전송을 요청했습니다.");
  }
  async recognized(text,app){
    const action=app?{query:text}:interpret(text);
    if(action.app && !action.query && !await this.launch(action.app))return;
    if(action.key){await this.act("send_command",{command:action.key});return}
    if(action.query){this.showInput(true);this.el("input").value=action.query;this.searchTarget=app||action.app;await this.sendQuery(action.query,this.searchTarget)}
    else this.say(text);
  }
  stopAudio(s){
    if(s.ended)return;s.ended=true;
    if(s.id!=null&&s.socket?.readyState===1)s.socket.send(new Uint8Array([s.id]));
    s.stream?.getTracks().forEach(t=>t.stop());s.node?.disconnect();s.source?.disconnect();
    if(s.ctx&&s.ctx.state!=="closed")s.ctx.close().catch(()=>{});
    if(this.session===s){this.el(".voice span").textContent="음성 처리 중…";this.el(".voice").disabled=true;}
  }
  endSession(){
    const s=this.session;if(!s)return;this.session=null;clearTimeout(s.limit);clearTimeout(s.timeout);this.stopAudio(s);
    if(s.unsubscribe)s.unsubscribe().catch(()=>{});
    this.el(".voice").disabled=false;this.el(".voice span").textContent="음성 명령";
  }
  disconnectedCallback(){this.endSession()}
  async listen(app){
    if(this.session)return;
    if(!navigator.mediaDevices?.getUserMedia){
      const bridge=this.ha.auth?.external;
      if(bridge?.config?.hasAssist && typeof bridge.fireMessage==="function"){
        bridge.fireMessage({type:"assist/show",payload:{pipeline_id:this.pipeline||"preferred",start_listening:true}});
        this.say(app?"예: "+app+"에서 아이유 검색":"안방 TV 음성 자동화에 등록한 명령을 말하세요.");
        return;
      }
      this.searchTarget=app;this.voiceInputMode=app?"query":"command";
      this.el("form button").textContent=app?"보내기":"실행";
      this.el("input").value="";
      this.showInput(true,true);

      this.say(app?"키보드 마이크로 제목을 말하고 TV 검색칸을 선택한 뒤 보내세요.":"키보드 마이크로 명령을 말한 뒤 실행을 누르세요.");
      return;
    }
    this.voiceInputMode="query";this.el("form button").textContent="보내기";const s={};this.session=s;
    this.el(".voice").disabled=true;this.say("마이크 연결 중…");
    try{
      const ctx=new AudioContext({sampleRate:16000});s.ctx=ctx;await ctx.resume();
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true}});
      if(this.session!==s){stream.getTracks().forEach(t=>t.stop());return}
      s.stream=stream;

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
        if(ev.type==="stt-start"){s.source.connect(s.node);s.node.connect(ctx.destination);this.el(".voice span").textContent="말하기 완료";this.el(".voice").disabled=false;this.say(app?"검색할 제목을 말하세요.":"예: 유튜브 열어 줘, 볼륨 올려 줘");s.limit=setTimeout(()=>this.stopAudio(s),10000);}
        if(ev.type==="stt-end"){const t=ev.data.stt_output?.text?.trim();this.endSession();if(t)this.recognized(t,app);else this.say("다시 말해 주세요.");}
        if(ev.type==="error"||ev.type==="run-end"){this.endSession();this.say(ev.data?.message||"음성을 인식하지 못했습니다.");}
      },msg,{resubscribe:false});
      if(this.session===s)s.unsubscribe=unsub;else unsub().catch(()=>{});
    }catch(e){if(this.session===s){this.endSession();this.say(e.message||"마이크 권한과 HA 음성 도우미 설정을 확인하세요.")}}
  }
  getCardSize(){return 7}
}
if(!customElements.get("android-remote-card"))customElements.define("android-remote-card",AndroidRemoteCard);
