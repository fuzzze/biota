// Biota — regenerate the 6 rotation templates from Sketch.
// Select the hex symbol (or an instance of it), then Run Script.
// Exports tpl_0.png .. tpl_5.png (the symbol at 0/60/.../300 deg, @1x) into OUT.
// Move them into Biota/templates/ (overwrite) so the decoder matches your asset.
//
// IMPORTANT: templates MUST come from the SAME asset used by the encoder, and
// from the SAME tool/rotation convention. If you encode in Figma, regenerate
// templates from Figma instead (see encoder/figma).

const sketch = require('sketch')
const OUT = '/Users/dmitrylozhkin/Work/Biota/templates'   // adjust if needed

const doc = sketch.getSelectedDocument()
const page = doc.selectedPage
const sel = doc.selectedLayers.layers[0]
if (!sel) throw new Error('Select the symbol or an instance of it')
const srcInst = sel.type === 'SymbolInstance' ? sel : sel.layers.find(l => l.type === 'SymbolInstance')
if (!srcInst) throw new Error('No symbol in selection')
const master = doc.getSymbols().find(s => s.symbolId === srcInst.symbolId)

const tmp = []
for (let k = 0; k < 6; k++) {
  const ins = master.createNewInstance()
  ins.frame.x = -99999
  ins.frame.y = -99999 + k * 600
  ins.transform.rotation = k * 60
  ins.name = 'tpl_' + k
  ins.parent = page
  tmp.push(ins)
}
sketch.export(tmp, { formats: 'png', scales: '1', output: OUT, overwriting: true })
tmp.forEach(t => t.remove())
sketch.UI.message('Exported tpl_0..5.png to ' + OUT)
