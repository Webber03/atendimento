// Cor dos status de contratos (definida em Listas & Status).
// Devolve o atributo style com a cor de fundo e o texto (claro ou escuro) de maior contraste.

function stLuminancia(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function stTextoSobre(hex) {
  const l = stLuminancia(hex);
  const comBranco = 1.05 / (l + 0.05);
  const comEscuro = (l + 0.05) / (stLuminancia('#18181b') + 0.05);
  return comEscuro >= comBranco ? '#18181b' : '#ffffff';
}

function stCorAttr(cor) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(cor || ''))) return '';
  return ` style="--st:${cor};--st-tx:${stTextoSobre(cor)}"`;
}
