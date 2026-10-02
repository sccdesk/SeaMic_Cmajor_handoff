using System;
using System.IO;
using System.Text;
class DumpWav {
  static void Main(string[] args) {
    string p = args[0];
    using (var f = File.OpenRead(p)) {
      byte[] h = new byte[128];
      int r = f.Read(h, 0, h.Length);
      Console.WriteLine("len=" + f.Length + " read=" + r);
      Console.WriteLine(Encoding.ASCII.GetString(h, 0, r).Replace("\0", "."));
      Console.Write("hex0-64: ");
      for (int i = 0; i < 64; i++) Console.Write(h[i].ToString("X2") + " ");
      Console.WriteLine();
      for (int off = 0; off < 120; off += 16) {
        string tag = "";
        for (int i = 0; i < 4; i++) tag += (h[off+i] >= 32 && h[off+i] < 127) ? (char)h[off+i] : '.';
        Console.WriteLine(off.ToString("D3") + " " + tag
          + " u32=" + BitConverter.ToUInt32(h, off)
          + " i16[0]=" + BitConverter.ToInt16(h, off) + " i16[1]=" + BitConverter.ToInt16(h, off+2));
      }
    }
  }
}
