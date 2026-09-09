/**
 * 找出源码里**没有包在 T(zh, en) 里**的中文字符串字面量。
 *
 * 为什么要自己扫而不是用正则匹配 `log(\`…中文…\`)`：真机上漏掉的那条是
 * `log(cond ? \`…配音…\` : \`…复用配音…\`)`——中文藏在三元分支里，而且调用跨了行，
 * 按行、按"log( 后紧跟字面量"都查不出来。所以逐字符走一遍：跳注释、认模板串与 ${} 嵌套，
 * 再看每个中文字面量前面紧挨着的是不是 `T(`。
 */
// 逐字符扫：正则回溯会炸，而且要跨行、要认模板串
export function cjkLiterals(src) {
  const out = []; let i = 0; const n = src.length;
  const isSpace = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t';
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; const start = i; i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (depth > 0) { if (src[i] === '}') depth--; i++; continue; }
        if (src[i] === q) break;
        if (q !== '`' && src[i] === '\n') break;
        i++;
      }
      const lit = src.slice(start, i + 1); i++;
      if (/[一-鿿]/.test(lit)) {
        let j = start - 1; while (j >= 0 && isSpace(src[j])) j--;
        const before = src.slice(Math.max(0, j - 1), j + 1);
        const line = src.slice(0, start).split('\n').length;
        out.push({ line, lit: lit.slice(0, 90), wrapped: before === 'T(' });
      }
      continue;
    }
    i++;
  }
  return out;
}
