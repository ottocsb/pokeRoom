// Voice chat: WebRTC mesh (every pair connects directly), the server only relays signaling.
// Whoever joins calls everyone already in the channel; the others just answer.
import type { ClientMsg } from './protocol';

type Signal = { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };

/** debug output in the browser console, filter by "[voice]" */
const log = (...a: unknown[]) => console.log('[voice]', ...a);

// STUN servers reachable from mainland China (third-party, free, no guarantee); for a TURN relay add your own coturn here
const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.miwifi.com:3478', 'stun:stun.chat.bilibili.com:3478', 'stun:stun.qq.com:3478'] }],
};

export class Voice {
  /** own microphone (null = not in the channel) */
  private mic: MediaStream | null = null;
  private peers = new Map<string, { pc: RTCPeerConnection; audio: HTMLAudioElement }>();
  muted = false;
  /** a peer connection got through / failed */
  onState: (user: string, ok: boolean) => void = () => {};

  constructor(private send: (m: ClientMsg) => void) {}

  get on() {
    return !!this.mic;
  }

  /** ask for the microphone (the caller then tells the server); throws if permission is denied */
  async join() {
    if (this.mic) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持语音（需要 HTTPS 或 localhost）');
    this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.muted = false;
    log('mic ok', this.mic.getAudioTracks().map((t) => `${t.label} enabled=${t.enabled} state=${t.readyState}`));
  }

  leave(tell = true) {
    if (!this.mic) return;
    log('leave');
    for (const u of [...this.peers.keys()]) this.drop(u);
    this.mic.getTracks().forEach((t) => t.stop());
    this.mic = null;
    if (tell) this.send({ t: 'voice', on: false });
  }

  setMuted(m: boolean) {
    log('muted', m);
    this.muted = m;
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !m));
  }

  /** server reply to our join: call everyone already there */
  async callAll(users: string[]) {
    log('joined, calling', users);
    for (const u of users) {
      const pc = this.connect(u);
      await pc.setLocalDescription(await pc.createOffer());
      this.signal(u, { sdp: pc.localDescription!.toJSON() });
    }
  }

  async onSignal(from: string, data: Signal) {
    log('recv from', from, data.sdp ? data.sdp.type : `ice ${data.ice?.candidate}`);
    if (!this.mic) return log('not in voice, ignored');
    if (data.sdp?.type === 'offer') {
      // a (re)joining peer calls us: always start a fresh connection
      this.drop(from);
      const pc = this.connect(from);
      await pc.setRemoteDescription(data.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      this.signal(from, { sdp: pc.localDescription!.toJSON() });
      return;
    }
    const pc = this.peers.get(from)?.pc;
    if (!pc) return log('no connection with', from, ', ignored');
    if (data.sdp) await pc.setRemoteDescription(data.sdp);
    else if (data.ice) await pc.addIceCandidate(data.ice).catch(() => {});
  }

  /** the server's member list changed: hang up on whoever left the channel */
  sync(users: string[]) {
    for (const u of [...this.peers.keys()])
      if (!users.includes(u)) {
        log(u, 'left the channel');
        this.drop(u);
      }
  }

  private connect(user: string) {
    const pc = new RTCPeerConnection(ICE);
    const audio = new Audio();
    audio.autoplay = true;
    this.mic!.getTracks().forEach((t) => pc.addTrack(t, this.mic!));
    log('connect', user);
    pc.onicecandidate = (e) => {
      // typ host = LAN, srflx = public address via STUN, relay = TURN; no srflx means STUN is unreachable
      log(user, e.candidate ? `local candidate ${e.candidate.type} ${e.candidate.protocol} ${e.candidate.address}:${e.candidate.port}` : 'candidates done');
      if (e.candidate) this.signal(user, { ice: e.candidate.toJSON() });
    };
    pc.onicecandidateerror = (e) => log(user, 'ice error', (e as RTCPeerConnectionIceErrorEvent).url, (e as RTCPeerConnectionIceErrorEvent).errorText);
    pc.oniceconnectionstatechange = () => log(user, 'ice', pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      log(user, 'connection', pc.connectionState);
      if (pc.connectionState === 'connected') this.onState(user, true);
      else if (pc.connectionState === 'failed') this.onState(user, false);
    };
    pc.ontrack = (e) => {
      log(user, 'got audio track', e.track.readyState);
      audio.srcObject = e.streams[0];
      audio
        .play()
        .then(() => log(user, 'playing'))
        .catch((err) => log(user, 'play blocked', err));
    };
    this.peers.set(user, { pc, audio });
    return pc;
  }

  private drop(user: string) {
    const p = this.peers.get(user);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    this.peers.delete(user);
  }

  private signal(to: string, data: Signal) {
    this.send({ t: 'rtc', to, data });
  }
}
