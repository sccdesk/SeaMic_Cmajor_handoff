using System;
using System.IO;
class AnWav {
  static double RmsDb(double ss, int nn) { return 10*Math.Log10(Math.Max(1e-12, ss/Math.Max(1,nn))); }
  static void Main(string[] args) {
    string inp = args[0], outp = args[1];
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
      double peak = 0, sumSq = 0; int over = 0;
      double[] segSq = new double[7]; int[] segN = new int[7];
      for (int i = 0; i < n; i++) {
        double v = 0;
        for (int c = 0; c < ch; c++) {
          double s = (bits == 16) ? br.ReadInt16()/32768.0 : (double)br.ReadSingle();
          if (c == 0) v = s;
        }
        double a = Math.Abs(v);
        if (a > peak) peak = a;
        if (a > 1.0) over++;
        sumSq += v*v;
        int seg = Math.Min(6, (int)((long)i * 7 / n));
        segSq[seg] += v*v; segN[seg]++;
      }
      using (var w = new StreamWriter(outp)) {
        w.WriteLine("fmt=" + fmtKind + " channels=" + ch + " rate=" + fs + " bits=" + bits + " frames=" + n);
        w.WriteLine("peak=" + peak.ToString("F6") + " strictlyOver0dB=" + over);
        w.WriteLine("rms_total_dBFS=" + RmsDb(sumSq, n).ToString("F2"));
        for (int s = 0; s < 7; s++)
          w.WriteLine("seg" + s + "_rms_dBFS=" + RmsDb(segSq[s], segN[s]).ToString("F2"));
      }
      Console.WriteLine("analysed " + inp + " fmt=" + fmtKind + " ch=" + ch + " fs=" + fs);
    }
  }
}
