// Fast stimulus generator: 16kHz mono 16-bit WAV, 7 s.
// 0-1s noise -50dB | 1-3s speech-like -30dB (+transient @2.5s) |
// 3-4s noise -40dB | 4-6s speech -6dB | 6-7s noise -50dB
using System;
using System.IO;
class MkStim {
  static double Db2Lin(double db) { return Math.Pow(10.0, db / 20.0); }
  static void Main(string[] args) {
    string outp = args.Length > 0 ? args[0] : "stimulus16k.wav";
    int fs = 16000;
    var rnd = new Random(12345);
    double[] amps = { 1.0, 0.6, 0.4, 0.25, 0.15 };
    int total = fs * 7;
    short[] data = new short[total];
    for (int n = 0; n < total; n++) {
      double t = n / (double)fs, v;
      if (t < 1.0)      v = Db2Lin(-50) * (rnd.NextDouble()*2-1);
      else if (t < 3.0) v = Speech(t, Db2Lin(-30), rnd, amps);
      else if (t < 4.0) v = Db2Lin(-40) * (rnd.NextDouble()*2-1);
      else if (t < 6.0) v = Speech(t, Db2Lin(-6), rnd, amps);
      else              v = Db2Lin(-50) * (rnd.NextDouble()*2-1);
      if (v > 1.0) v = 1.0; if (v < -1.0) v = -1.0;
      data[n] = (short)Math.Round(v * 32767);
    }
    data[(int)(2.5*fs)] = (short)(0.8 * 32767); // transient for limiter test
    using (var f = new FileStream(outp, FileMode.Create)) using (var bw = new BinaryWriter(f)) {
      int bytes = total * 2;
      bw.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); bw.Write(36 + bytes);
      bw.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); bw.Write(16); bw.Write((short)1);
      bw.Write((short)1); bw.Write(fs); bw.Write(fs*2); bw.Write((short)2); bw.Write((short)16);
      bw.Write(System.Text.Encoding.ASCII.GetBytes("data")); bw.Write(bytes);
      foreach (short s in data) bw.Write(s);
    }
    Console.WriteLine("wrote " + outp + " (" + total + " samples)");
  }
  static double Speech(double t, double rms, Random rnd, double[] amps) {
    double f0 = 130.0, s = 0.0;
    for (int h = 0; h < 5; h++) s += amps[h] * Math.Sin(2*Math.PI*f0*(h+1)*t);
    double am = 0.6 + 0.4 * Math.Sin(2*Math.PI*4.0*t);
    s = s * am / 2.2 + 0.05 * (rnd.NextDouble()*2-1);
    return s * rms / 0.45;
  }
}
