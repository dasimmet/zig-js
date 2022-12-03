import { NAN_PREFIX, PREDEFINED_ID_MAX, predefined } from './ref';

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/**
 * The main state.
 * */
export class ZigJS {
  /**
   * Set this to the memory of your WebAssembly instance prior to making
   * any Wasm calls that might interface with JS.
   * */
  memory?: DataView;

  /**
   * The values, indexed by ID (number). Duplicate values can be in this
   * if they are loaded multiple times. That just acts as duplicate references.
   * */
  private values: Array<any> = [NaN, null, true, false, undefined, globalThis];

  /**
   * When a value is removed from the values array, its ID is put
   * in the pool so that we can use it next. This avoids fragmentation in
   * our array keys.
   * */
  private idPool: Array<number> = [];

  /**
   * Returns the import object that should be merged with your import
   * object when instantiating your wasm instance. This injects the required
   * functions into the wasm environment.
   * */
  importObject(): ImportObject {
    return {
      "zig-js": {
        valueGet: this.valueGet.bind(this),
        valueSet: this.valueSet.bind(this),
        valueDeinit: this.valueDeinit.bind(this),
        valueObjectCreate: this.valueObjectCreate.bind(this),
        valueStringCreate: this.valueStringCreate.bind(this),
        valueStringLen: this.valueStringLen.bind(this),
        valueStringCopy: this.valueStringCopy.bind(this),
      },
    };
  }

  /**
   * Get a value from the JS environment.
   * */
  protected valueGet(out: number, id: number, ptr: number, len: number): void {
    const val = this.loadValue(id);
    const str = this.loadString(ptr, len);
    const result = Reflect.get(val, str);
    this.storeValue(out, result);
  }

  /**
   * Set a value on an object.
   * */
  protected valueSet(id: number, ptr: number, len: number, refAddr: number): void {
    const obj = this.loadValue(id);
    const str = this.loadString(ptr, len);
    const val = this.loadRef(refAddr);
    Reflect.set(obj, str, val);
  }

  /**
   * Dereference a value, allowing the JS environment to potentially GC it.
   * */
  protected valueDeinit(id: number): void {
    // Do not allow deinitializing our predefined values
    if (id > PREDEFINED_ID_MAX) {
      this.values[id] = null;
      this.idPool.push(id);
    }
  }

  /**
   * Create an empty object.
   * */
  protected valueObjectCreate(out: number): void {
    this.storeValue(out, new Object());
  }

  /**
   * Creates a string on the JS side from a UTF-8 encoded string in wasm memory.
   * */
  protected valueStringCreate(out: number, ptr: number, len: number): void {
    const str = this.loadString(ptr, len);
    this.storeValue(out, str);
  }


  /**
   * Returns the length of the string given by id.
   * */
  protected valueStringLen(id: number): number {
    const val = this.loadValue(id);
    const buf = encoder.encode(val);
    return buf.byteLength;
  }

  /**
   * Copy the string at id "id" into the shared memory at ptr.
   * */
  protected valueStringCopy(id: number, ptr: number, max: number): void {
    if (this.memory == null) return;

    const val = this.loadValue(id);
    const bytes = encoder.encode(val);
    if (bytes.byteLength > max) return;
    new Uint8Array(this.memory.buffer, ptr, bytes.length).set(bytes);
  }

  loadRef(refAddr: number): any {
    if (this.memory == null) return;

    // If the value at the memory location is not a NaN, return it directly.
    const floatVal = this.memory.getFloat64(refAddr, true);
    if (!isNaN(floatVal)) return floatVal;

    // If it is a NaN, we need to get the ID.
    const id = this.loadRefId(refAddr);
    return this.values[id];
  }

  loadRefId(refAddr: number): number {
    if (this.memory == null) return 0;
    return this.memory.getUint32(refAddr, true);
  }

  loadValue(id: number): any {
    return this.values[id];
  }

  storeValue(out: number, val: any): void {
    if (this.memory == null) return;

    if (typeof val === "number") {
      // We have to turn NaNs into a single value (since NaN can be
      // represented by multiple encodings).
      if (isNaN(val)) {
        this.memory.setUint32(out, predefined.nan, true);
        this.memory.setUint32(out + 4, NAN_PREFIX, true);
      } else {
        this.memory.setFloat64(out, val, true);
      }

      return;
    }

    if (val === null) {
      this.memory.setUint32(out, predefined.null, true);
      this.memory.setUint32(out + 4, NAN_PREFIX, true);
      return;
    }

    if (val === undefined) {
      this.memory.setUint32(out, predefined.undefined, true);
      this.memory.setUint32(out + 4, NAN_PREFIX, true);
      return;
    }

    // Determine our ID
    let id = this.idPool.pop();
    if (id === undefined) {
      id = this.values.length;
    }
    this.values[id] = val;

    // All other values have to have a type set.
    let typeId = 0;
    switch (typeof val) {
      case "object":
        typeId = 1;
        break;
      case "string":
        typeId = 2;
        break;
      case "symbol":
        typeId = 3;
        break;
      case "function":
        typeId = 4;
        break;
    }

    // Set the fields
    this.memory.setUint32(out, id, true);
    this.memory.setUint32(out + 4, NAN_PREFIX | typeId, true);
  }

  loadString(ptr: number, len: number): string {
    if (this.memory == null) return "";
    return decoder.decode(new DataView(this.memory.buffer, ptr, len));
  }
}

export interface ImportObject {
  "zig-js": {
    valueGet: (out: number, id: number, ptr: number, len: number) => void;
    valueSet: (id: number, ptr: number, len: number, valueRef: number) => void;
    valueObjectCreate: (out: number) => void;
    valueStringCreate: (out: number, ptr: number, len: number) => void;
    valueStringLen: (id: number) => number;
    valueStringCopy: (id: number, ptr: number, max: number) => void;
    valueDeinit: (id: number) => void;
  };
};
