"""Render the actual WebGL shaders using surfaceless EGL, without a browser.

Requires Mesa EGL/GLES, Pillow, NumPy and Node; these are QA dependencies only.
Usage: python qa/render_motion.py /absolute/path/to/qa-output
"""
import ctypes as C
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'motion-qa'
OUT.mkdir(parents=True, exist_ok=True)
WIDTH, HEIGHT = 840, 425
EGL_NONE = 0x3038
E = C.CDLL('libEGL.so.1')


def egl(name, result, *args):
    fn = getattr(E, name)
    fn.restype, fn.argtypes = result, list(args)
    return fn


get_proc = egl('eglGetProcAddress', C.c_void_p, C.c_char_p)
get_display = C.CFUNCTYPE(C.c_void_p, C.c_uint, C.c_void_p, C.POINTER(C.c_int))(
    get_proc(b'eglGetPlatformDisplayEXT'))
display = get_display(0x31DD, None, None)
major, minor = C.c_int(), C.c_int()
assert egl('eglInitialize', C.c_uint, C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_int))(
    display, C.byref(major), C.byref(minor)), 'EGL initialize failed'
assert egl('eglBindAPI', C.c_uint, C.c_uint)(0x30A0), 'Cannot bind GLES'
attrs = (C.c_int * 15)(0x3033, 1, 0x3040, 4, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3025, 0, EGL_NONE)
config, count = C.c_void_p(), C.c_int()
assert egl('eglChooseConfig', C.c_uint, C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_void_p), C.c_int, C.POINTER(C.c_int))(
    display, attrs, C.byref(config), 1, C.byref(count)) and count.value
surface_attrs = (C.c_int * 5)(0x3057, WIDTH, 0x3056, HEIGHT, EGL_NONE)
surface = egl('eglCreatePbufferSurface', C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_int))(
    display, config, surface_attrs)
context_attrs = (C.c_int * 3)(0x3098, 2, EGL_NONE)
context = egl('eglCreateContext', C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_int))(
    display, config, None, context_attrs)
assert surface and context, 'Cannot create ES2 surface/context'
assert egl('eglMakeCurrent', C.c_uint, C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p)(
    display, surface, surface, context)


def gl(name, result, *args):
    address = get_proc(name.encode())
    assert address, name
    return C.CFUNCTYPE(result, *args)(address)


uint = C.c_uint
integer = C.c_int
flt = C.c_float
ptr = C.c_void_p
create_shader = gl('glCreateShader', uint, uint)
shader_source = gl('glShaderSource', None, uint, integer, C.POINTER(C.c_char_p), C.POINTER(integer))
compile_shader = gl('glCompileShader', None, uint)
get_shader = gl('glGetShaderiv', None, uint, uint, C.POINTER(integer))
shader_log = gl('glGetShaderInfoLog', None, uint, integer, C.POINTER(integer), ptr)
sources = json.loads(subprocess.check_output([
    'node', '-e', 'console.log(JSON.stringify(require("./dist/auth-shaders.js")))'], cwd=ROOT))


def compile_one(kind, source):
    shader = create_shader(kind)
    data = C.c_char_p(source.encode())
    shader_source(shader, 1, C.byref(data), None)
    compile_shader(shader)
    status = integer()
    get_shader(shader, 0x8B81, C.byref(status))
    if not status.value:
        log = C.create_string_buffer(8192)
        shader_log(shader, len(log), None, log)
        raise AssertionError(log.value.decode())
    return shader


vertex = compile_one(0x8B31, sources['vertex'])
fragment = compile_one(0x8B30, sources['fragment'])
program = gl('glCreateProgram', uint)()
attach = gl('glAttachShader', None, uint, uint)
attach(program, vertex)
attach(program, fragment)
gl('glLinkProgram', None, uint)(program)
status = integer()
gl('glGetProgramiv', None, uint, uint, C.POINTER(integer))(program, 0x8B82, C.byref(status))
assert status.value, 'Shader program link failed'
gl('glUseProgram', None, uint)(program)
buffer = uint()
gl('glGenBuffers', None, integer, C.POINTER(uint))(1, C.byref(buffer))
gl('glBindBuffer', None, uint, uint)(0x8892, buffer)
vertices = (flt * 8)(-1, -1, 1, -1, -1, 1, 1, 1)
gl('glBufferData', None, uint, C.c_ssize_t, ptr, uint)(0x8892, C.sizeof(vertices), vertices, 0x88E4)
position = gl('glGetAttribLocation', integer, uint, C.c_char_p)(program, b'a_position')
gl('glEnableVertexAttribArray', None, uint)(position)
gl('glVertexAttribPointer', None, uint, integer, uint, C.c_ubyte, integer, ptr)(position, 2, 0x1406, 0, 0, None)
uniform = gl('glGetUniformLocation', integer, uint, C.c_char_p)
uniform1i = gl('glUniform1i', None, integer, integer)
uniform1f = gl('glUniform1f', None, integer, flt)
uniform2f = gl('glUniform2f', None, integer, flt, flt)
tex_parameter = gl('glTexParameteri', None, uint, uint, integer)
tex_image = gl('glTexImage2D', None, uint, integer, integer, integer, integer, integer, uint, uint, ptr)
for index, filename in enumerate(['brand-day.png', 'brand-night.png']):
    tex = uint()
    gl('glGenTextures', None, integer, C.POINTER(uint))(1, C.byref(tex))
    gl('glActiveTexture', None, uint)(0x84C0 + index)
    gl('glBindTexture', None, uint, uint)(0x0DE1, tex)
    for parameter, value in [(0x2801, 0x2601), (0x2800, 0x2601), (0x2802, 0x812F), (0x2803, 0x812F)]:
        tex_parameter(0x0DE1, parameter, value)
    im = Image.open(ROOT / 'dist/assets' / filename).convert('RGBA')
    pixels = C.create_string_buffer(im.tobytes())
    tex_image(0x0DE1, 0, 0x1908, im.width, im.height, 0, 0x1908, 0x1401, pixels)
    uniform1i(uniform(program, b'u_night' if index else b'u_day'), index)

gl('glViewport', None, integer, integer, integer, integer)(0, 0, WIDTH, HEIGHT)
uniform2f(uniform(program, b'u_resolution'), WIDTH, HEIGHT)
read_pixels = gl('glReadPixels', None, integer, integer, integer, integer, uint, uint, ptr)
frames = {}
for name, mode, elapsed, point, hover in [
    ('day-0', 0, 0, (0, 0), 0), ('day-8', 0, 8, (0, 0), 0),
    ('night-0', 1, 0, (0, 0), 0), ('night-8', 1, 8, (0, 0), 0),
    ('day-pointer', 0, 8, (0.12, 0.3), 1), ('night-pointer', 1, 8, (0.12, 0.3), 1),
    ('transition', .5, 4, (0, 0), 0)
]:
    uniform1f(uniform(program, b'u_time'), elapsed)
    uniform1f(uniform(program, b'u_theme'), mode)
    uniform2f(uniform(program, b'u_pointer'), *point)
    uniform2f(uniform(program, b'u_focus'), .56, .55)
    uniform1f(uniform(program, b'u_hover'), hover)
    gl('glDrawArrays', None, uint, integer, integer)(0x0005, 0, 4)
    pixels = (C.c_ubyte * (WIDTH * HEIGHT * 4))()
    read_pixels(0, 0, WIDTH, HEIGHT, 0x1908, 0x1401, pixels)
    assert gl('glGetError', uint)() == 0, f'GL error in {name}'
    array = np.ctypeslib.as_array(pixels).reshape(HEIGHT, WIDTH, 4)[::-1].copy()
    frames[name] = array
    # Composite only for QA viewing; runtime uses transparent canvas edges.
    color = tuple(round(a * (1-mode) + b * mode) for a, b in zip((237, 230, 222), (45, 41, 37)))
    image = Image.fromarray(array, 'RGBA')
    background = Image.new('RGBA', image.size, (*color, 255))
    background.alpha_composite(image)
    background.convert('RGB').save(OUT / (name + '.png'))

metrics = {}
for mode in ['day', 'night']:
    a = frames[mode + '-0'][50:390, 200:650, :3].astype(float)
    b = frames[mode + '-8'][50:390, 200:650, :3].astype(float)
    c = frames[mode + '-pointer'][50:390, 200:650, :3].astype(float)
    metrics[mode] = {'light_mean_delta': round(float(np.abs(a-b).mean()), 3),
                     'pointer_mean_delta': round(float(np.abs(c-b).mean()), 3)}
    assert metrics[mode]['light_mean_delta'] > 4, 'Autonomous lighting is not visible enough'
    assert metrics[mode]['pointer_mean_delta'] > 2, 'Pointer reveal is not visible enough'
    alpha = frames[mode + '-0'][:, :, 3]
    perimeter = np.concatenate([alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]])
    metrics[mode]['perimeter_alpha_max'] = int(perimeter.max())
    assert perimeter.max() <= 1, 'Photographic frame can remain visible at a boundary'
    assert alpha[70:300, 220:290].min() == 255, 'The sculpture must remain opaque'

sheet = Image.new('RGB', (WIDTH*2, (HEIGHT+28)*3), '#171512')
draw = ImageDraw.Draw(sheet)
for i, name in enumerate(['day-0', 'day-8', 'night-0', 'night-8', 'day-pointer', 'night-pointer']):
    x, y = (i % 2)*WIDTH, (i // 2)*(HEIGHT+28)
    draw.text((x+12, y+7), name, fill='#eee6de')
    sheet.paste(Image.open(OUT / (name+'.png')), (x, y+28))
sheet.save(OUT / 'contact-sheet.jpg', quality=94)
(OUT / 'metrics.json').write_text(json.dumps(metrics, indent=2) + '\n')
print(json.dumps({'egl': f'{major.value}.{minor.value}', 'shader_compilation': 'PASS',
                  'frames': len(frames), 'metrics': metrics, 'output': str(OUT)}))
egl('eglMakeCurrent', C.c_uint, ptr, ptr, ptr, ptr)(display, None, None, None)
egl('eglDestroyContext', C.c_uint, ptr, ptr)(display, context)
egl('eglDestroySurface', C.c_uint, ptr, ptr)(display, surface)
egl('eglTerminate', C.c_uint, ptr)(display)
