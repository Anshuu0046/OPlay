using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AetherPower {
  static readonly Guid Processor=new Guid("54533251-82be-4824-96c1-47b60b740d00");
  static readonly Guid Max=new Guid("bc5038f7-23e0-4960-96da-33abaf5935ec");
  static readonly Guid Epp=new Guid("36687f9e-e3a5-4dbf-b1dc-15eb381c6863");
  static readonly Guid Boost=new Guid("be337238-0d82-4146-a960-4f3749d470c7");
  [DllImport("powrprof.dll")] static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr scheme);
  [DllImport("powrprof.dll")] static extern uint PowerReadACValueIndex(IntPtr root, ref Guid scheme, ref Guid subgroup, ref Guid setting, out uint value);
  [DllImport("powrprof.dll")] static extern uint PowerWriteACValueIndex(IntPtr root, ref Guid scheme, ref Guid subgroup, ref Guid setting, uint value);
  [DllImport("powrprof.dll")] static extern uint PowerSetActiveScheme(IntPtr root, ref Guid scheme);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
  public static void HoldAwake() { if(SetThreadExecutionState(0x80000003)==0)throw new Win32Exception(); }
  static void Check(uint code) { if(code!=0) throw new Win32Exception((int)code); }
  static Guid Setting(string name) { if(name=="MaximumProcessorState")return Max; if(name=="EnergyPreference")return Epp; if(name=="BoostMode")return Boost; throw new ArgumentException("Invalid power setting"); }
  public static string Active() { IntPtr p; Check(PowerGetActiveScheme(IntPtr.Zero,out p)); try {return ((Guid)Marshal.PtrToStructure(p,typeof(Guid))).ToString();}finally{LocalFree(p);} }
  public static uint Read(string scheme, string name) { var id=new Guid(scheme); var sub=Processor; var setting=Setting(name); uint value; Check(PowerReadACValueIndex(IntPtr.Zero,ref id,ref sub,ref setting,out value)); return value; }
  public static uint Write(string scheme,string name,uint value) {
    if(value>100)throw new ArgumentOutOfRangeException("value");
    if(name=="BoostMode" && value>6)throw new ArgumentOutOfRangeException("value");
    var id=new Guid(scheme); var sub=Processor; var setting=Setting(name);
    if(Active()!=scheme)throw new InvalidOperationException("Active Windows power plan changed; select the original plan before modifying or undoing it");
    Check(PowerWriteACValueIndex(IntPtr.Zero,ref id,ref sub,ref setting,value)); Check(PowerSetActiveScheme(IntPtr.Zero,ref id)); return Read(scheme,name);
  }
}
