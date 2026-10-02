using System;
using System.IO;
class VadProbe {
  static void Main(string[] args) {
    // args: render_v2.wav (float32 stereo: ch0=audio, ch1=vad? actually both dup)
    // cmaj duplicates mono->stereo so we can't see vadFlag; instead re-derive:
    // print per-100ms RMS + SNR-vs-running-min to show where VAD decides.
    string inp = args[0];
    using (var f = new FileStream(inp, FileMode.Open)) using (var br = new BinaryReader(f)) {
      br.ReadBytes(12);
      int fs = 0, ch = 0, bits = 0, dataLen = 0; short fmtKind = 1; long dataPos = 0;
      while (f.Position + 8 <= f.Length) {
        byte[] id = br.ReadBytes(4); int len = br.ReadInt32();
        long next = f.Position + len + (len % 2);
        string tag = "" + (char)id[0] + (char)id[1] + (char)id[2] + (char)id[3];
        if (tag == "fmt ") {
          fmtKind = br.ReadInt16(); ch = br.ReadInt16(); fs = br.ReadInt32();
          br.ReadInt32(); br.ReadInt16(); bits = br.ReadInt16();
          if (len > 16) br.ReadBytes(len - 16);
        } else if (tag == "data") { dataLen = len; dataPos = f.Position; break; }
        f.Position = next;
      }
      f.Position = dataPos;
      int bytesPer = bits/8, n = dataLen / (bytesPer * ch);
      int hop = fs / 10; // 100 ms
      double floorMin = 1e-7, floor = 1e-4;
      for (int start = 0; start < n; start += hop) {
        double ss = 0; int cnt = Math.Min(hop, n - start);
        long save = f.Position;
        for (int i = 0; i < cnt; i++) {
          double v = 0;
          for (int c = 0; c < ch; c++) {
            double s = fmtKind == 3 ? (double)br.ReadSingle() : br.ReadInt16()/32768.0;
            if (c == 0) v = s;
          }
          ss += v*v;
        }
        double rms = Math.Sqrt(Math.Max(1e-14, ss/cnt));
        if (rms < floor) floor = rms; // running min like VAD
        double snr = 20*Math.Log10(rms/Math.Max(1e-7, floor));
        Console.WriteLine((start/(double)fs).ToString("F1").PadLeft(5)
          + "s rms=" + (20*Math.Log10(rms)).ToString("F1").PadLeft(7)
          + " floor=" + (20*Math.Log10(Math.Max(1e-7,floor))).ToString("F1").PadLeft(7)
          + " snr=" + snr.ToString("F1").PadLeft(6));
      }
    }
  }
}
