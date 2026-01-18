/* @ts-self-types="./boids_wasm.d.ts" */

/**
 * Main boids computation engine
 *
 * Manages memory buffers and provides the interface for JS to
 * populate unit data and retrieve computed forces.
 */
export class BoidsEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BoidsEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_boidsengine_free(ptr, 0);
    }
    /**
     * Get the buffer capacity (max units)
     * @returns {number}
     */
    get capacity() {
        const ret = wasm.boidsengine_capacity(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Clear all buffers for reuse
     */
    clear() {
        wasm.boidsengine_clear(this.__wbg_ptr);
    }
    /**
     * Compute all boids forces using SIMD
     *
     * Prerequisites:
     * 1. Populate input arrays (positions, velocities, radii, states, layers)
     * 2. Set unit_count
     * 3. Populate neighbor arrays (neighbors, offsets, counts)
     * 4. Set neighbor_total
     *
     * After calling, read results from force arrays.
     */
    compute_forces() {
        wasm.boidsengine_compute_forces(this.__wbg_ptr);
    }
    /**
     * Get pointer to alignment force X array (read after compute)
     * @returns {number}
     */
    force_align_x_ptr() {
        const ret = wasm.boidsengine_force_align_x_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to alignment force Y array (read after compute)
     * @returns {number}
     */
    force_align_y_ptr() {
        const ret = wasm.boidsengine_force_align_y_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to cohesion force X array (read after compute)
     * @returns {number}
     */
    force_coh_x_ptr() {
        const ret = wasm.boidsengine_force_coh_x_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to cohesion force Y array (read after compute)
     * @returns {number}
     */
    force_coh_y_ptr() {
        const ret = wasm.boidsengine_force_coh_y_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to separation force X array (read after compute)
     * @returns {number}
     */
    force_sep_x_ptr() {
        const ret = wasm.boidsengine_force_sep_x_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to separation force Y array (read after compute)
     * @returns {number}
     */
    force_sep_y_ptr() {
        const ret = wasm.boidsengine_force_sep_y_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to layers array (u8)
     * @returns {number}
     */
    layers_ptr() {
        const ret = wasm.boidsengine_layers_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to neighbor counts array (for JS to populate)
     * @returns {number}
     */
    neighbor_counts_ptr() {
        const ret = wasm.boidsengine_neighbor_counts_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to neighbor offsets array (for JS to populate)
     * @returns {number}
     */
    neighbor_offsets_ptr() {
        const ret = wasm.boidsengine_neighbor_offsets_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to neighbors array (for JS to populate)
     * @returns {number}
     */
    neighbors_ptr() {
        const ret = wasm.boidsengine_neighbors_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new boids engine with capacity for `max_units`
     * @param {number} max_units
     */
    constructor(max_units) {
        const ret = wasm.boidsengine_new(max_units);
        this.__wbg_ptr = ret >>> 0;
        BoidsEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get pointer to positions X array
     * @returns {number}
     */
    positions_x_ptr() {
        const ret = wasm.boidsengine_positions_x_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to positions Y array
     * @returns {number}
     */
    positions_y_ptr() {
        const ret = wasm.boidsengine_positions_y_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to radii array
     * @returns {number}
     */
    radii_ptr() {
        const ret = wasm.boidsengine_radii_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Set alignment parameters
     * @param {number} radius
     * @param {number} strength
     */
    set_alignment_params(radius, strength) {
        wasm.boidsengine_set_alignment_params(this.__wbg_ptr, radius, strength);
    }
    /**
     * Set cohesion parameters
     * @param {number} radius
     * @param {number} strength
     */
    set_cohesion_params(radius, strength) {
        wasm.boidsengine_set_cohesion_params(this.__wbg_ptr, radius, strength);
    }
    /**
     * Set minimum speed for alignment (units below this speed are ignored)
     * @param {number} speed
     */
    set_min_moving_speed(speed) {
        wasm.boidsengine_set_min_moving_speed(this.__wbg_ptr, speed);
    }
    /**
     * Set total neighbor count (after JS populates neighbor array)
     * @param {number} count
     */
    set_neighbor_total(count) {
        wasm.boidsengine_set_neighbor_total(this.__wbg_ptr, count);
    }
    /**
     * Set separation parameters
     * @param {number} radius
     * @param {number} strength
     * @param {number} max_force
     */
    set_separation_params(radius, strength, max_force) {
        wasm.boidsengine_set_separation_params(this.__wbg_ptr, radius, strength, max_force);
    }
    /**
     * Set the current unit count (after JS populates buffers)
     * @param {number} count
     */
    set unit_count(count) {
        wasm.boidsengine_set_unit_count(this.__wbg_ptr, count);
    }
    /**
     * Get pointer to states array (u8)
     * @returns {number}
     */
    states_ptr() {
        const ret = wasm.boidsengine_states_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the current unit count
     * @returns {number}
     */
    get unit_count() {
        const ret = wasm.boidsengine_unit_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to velocities X array
     * @returns {number}
     */
    velocities_x_ptr() {
        const ret = wasm.boidsengine_velocities_x_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to velocities Y array
     * @returns {number}
     */
    velocities_y_ptr() {
        const ret = wasm.boidsengine_velocities_y_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) BoidsEngine.prototype[Symbol.dispose] = BoidsEngine.prototype.free;

/**
 * Initialize panic hook for better error messages in browser console
 */
export function init() {
    wasm.init();
}

/**
 * Check if WASM SIMD is available
 * @returns {boolean}
 */
export function simd_supported() {
    const ret = wasm.simd_supported();
    return ret !== 0;
}

/**
 * Unit is active and should be processed
 * @returns {number}
 */
export function state_active() {
    const ret = wasm.state_active();
    return ret;
}

/**
 * Unit is dead/inactive
 * @returns {number}
 */
export function state_dead() {
    const ret = wasm.simd_supported();
    return ret;
}

/**
 * Unit is flying (different collision layer)
 * @returns {number}
 */
export function state_flying() {
    const ret = wasm.state_flying();
    return ret;
}

/**
 * Unit is gathering resources (no separation)
 * @returns {number}
 */
export function state_gathering() {
    const ret = wasm.state_gathering();
    return ret;
}

/**
 * Unit is a worker (special rules)
 * @returns {number}
 */
export function state_worker() {
    const ret = wasm.state_worker();
    return ret;
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_7534b8e9a36f1ab4: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_export(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_8a6f238a6ece86ea: function() {
            const ret = new Error();
            return addHeapObject(ret);
        },
        __wbg_stack_0ed75d68575b0f3c: function(arg0, arg1) {
            const ret = getObject(arg1).stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./boids_wasm_bg.js": import0,
    };
}

const BoidsEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_boidsengine_free(ptr >>> 0, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

let heap = new Array(128).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('boids_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

// Export memory getter for external access (wasm is only defined after init)
export const memory = {
    get buffer() { return wasm?.memory?.buffer; }
};

// Direct memory reference (available after init)
export function getMemory() {
    return wasm?.memory;
}

export { initSync, __wbg_init as default };
