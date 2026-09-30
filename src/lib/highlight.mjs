// Tiny build-time syntax highlighter (no dependencies).
// Produces BEM spans: <span class="code__tok code__tok--comment">…</span>

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tok = (type, s) => `<span class="code__tok code__tok--${type}">${esc(s)}</span>`;

const CPP_KEYWORDS = new Set(`void int long short char byte bool boolean float double unsigned signed const volatile static
  if else for while do switch case default break continue return true false HIGH LOW INPUT OUTPUT INPUT_PULLUP
  String struct class public private new delete sizeof uint8_t uint16_t uint32_t int8_t int16_t int32_t
  MSBFIRST LSBFIRST CHANGE RISING FALLING NULL define include`.split(/\s+/));

const CPP_BUILTINS = new Set(`setup loop pinMode digitalWrite digitalRead analogRead analogWrite delay millis micros
  shiftOut shiftIn attachInterrupt detachInterrupt digitalPinToInterrupt tone noTone map constrain
  Serial Wire lcd begin print println available read write parseFloat parseInt readStringUntil peek
  beginTransmission endTransmission requestFrom setCursor clear scrollDisplayLeft scrollDisplayRight
  createChar noInterrupts interrupts abs min max sqrt pow isDigit`.split(/\s+/));

function highlightCpp(code) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(^[ \t]*#[ \t]*\w+)|(\b0[xX][0-9a-fA-F]+\b|\b0[bB][01]+\b|\b\d+\.?\d*(?:[eE][-+]?\d+)?[fFuUlL]*\b)|([A-Za-z_]\w*)/gm;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) out += tok('comment', m[1]);
    else if (m[2]) out += tok('string', m[2]);
    else if (m[3]) out += tok('meta', m[3]);
    else if (m[4]) out += tok('number', m[4]);
    else if (CPP_KEYWORDS.has(m[5])) out += tok('keyword', m[5]);
    else if (CPP_BUILTINS.has(m[5])) out += tok('builtin', m[5]);
    else out += esc(m[5]);
  }
  return out + esc(code.slice(last));
}

function highlightAsm(code) {
  // MIPS-like assembly: comments (# …), labels (name:), registers ($t0), numbers, mnemonics
  return code.split('\n').map((line) => {
    const ci = line.indexOf('#');
    const body = ci >= 0 ? line.slice(0, ci) : line;
    const comment = ci >= 0 ? line.slice(ci) : '';
    const re = /(^\s*[A-Za-z_]\w*:)|(\$\w+)|(\b0x[0-9a-fA-F]+\b|-?\b\d+\b)|(^\s*[a-z]{1,7}\b|(?<=:\s*)[a-z]{1,7}\b)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(body))) {
      out += esc(body.slice(last, m.index));
      last = re.lastIndex;
      if (m[1]) out += tok('meta', m[1]);
      else if (m[2]) out += tok('builtin', m[2]);
      else if (m[3]) out += tok('number', m[3]);
      else out += tok('keyword', m[4]);
    }
    out += esc(body.slice(last));
    return out + (comment ? tok('comment', comment) : '');
  }).join('\n');
}

export function highlight(code, lang) {
  if (lang === 'cpp' || lang === 'c' || lang === 'arduino') return highlightCpp(code);
  if (lang === 'asm' || lang === 'mips') return highlightAsm(code);
  return esc(code);
}

export { esc };
