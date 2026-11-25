// Runs on the audio thread: forwards every microphone block to the page without gaps.
class SoundCommanderRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('sc-recorder', SoundCommanderRecorder);
