// code.js — Figma main thread.
// Receives the precomputed base-6 digits (encrypted + RS-coded in the UI) and
// builds the honeycomb grid of rotated component instances.

figma.showUI(__html__, { width: 320, height: 250, themeColors: true });

// Rotation direction. The 6 angles are closed under negation (a sign flip just
// permutes digits d -> (6-d)%6). Keep templates regenerated FROM Figma and this
// is irrelevant; flip to +1 only if reusing Sketch templates gives permuted text.
const DIRSIGN = -1;

async function resolveComponent(node) {
  if (!node) return null;
  if (node.type === 'COMPONENT') return node;
  if (node.type === 'INSTANCE') {
    if (typeof node.getMainComponentAsync === 'function') return await node.getMainComponentAsync();
    return node.mainComponent; // older API fallback
  }
  return null;
}

// Place `node` so its center sits at (cx,cy) in page coords, rotated by `deg`.
// Done via relativeTransform to rotate around the tile center (Figma's `rotation`
// pivot is unreliable across versions).
function setTile(node, cx, cy, deg) {
  const phi = DIRSIGN * deg * Math.PI / 180;
  const a = Math.cos(phi), c = Math.sin(phi), b = -Math.sin(phi), d = Math.cos(phi);
  const w = node.width, h = node.height;
  const e = cx - a * (w / 2) - c * (h / 2);
  const f = cy - b * (w / 2) - d * (h / 2);
  node.relativeTransform = [[a, c, e], [b, d, f]];
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'cancel') { figma.closePlugin(); return; }
  if (msg.type !== 'encode') return;

  const digits = msg.digits, cols = msg.cols;
  const sel = figma.currentPage.selection[0];
  const comp = await resolveComponent(sel);
  if (!comp) { figma.notify('Select the hex component (or an instance of it)'); return; }

  const W = comp.width;
  const dx = Math.round(W * Math.sqrt(3) / 2);   // 294 when W=340
  const dy = W * 0.75;                             // 255
  const off = dx / 2;                              // 147 — even-row shift
  const bb = sel.absoluteBoundingBox;
  const ox = bb.x + bb.width + 200, oy = bb.y;     // place next to the selection

  const nodes = [];
  for (let i = 0; i < digits.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const inst = comp.createInstance();
    const cx = ox + (r % 2 === 0 ? off : 0) + c * dx + W / 2;
    const cy = oy + r * dy + W / 2;
    setTile(inst, cx, cy, digits[i] * 60);
    nodes.push(inst);
  }

  const group = figma.group(nodes, figma.currentPage);
  group.name = 'encrypted';
  figma.currentPage.selection = [group];
  figma.viewport.scrollAndZoomIntoView([group]);
  figma.notify(`Encrypted + ECC: ${nodes.length} tiles`);
  figma.closePlugin();
};
