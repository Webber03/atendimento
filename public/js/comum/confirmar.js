// Confirmação no padrão do ATENDi, no lugar do confirm() do navegador.
// Uso: if (!(await confirmarAcao({ titulo, mensagem, confirmar: 'Excluir', perigo: true }))) return;
// Enter confirma, Esc cancela, o foco volta para onde estava.

function confirmarAcao({ titulo = 'Confirmar', mensagem = '', confirmar = 'Confirmar', cancelar = 'Cancelar', perigo = false } = {}) {
  return new Promise(resolve => {
    const voltarFoco = document.activeElement;
    const fundo = document.createElement('div');
    fundo.className = 'cf-fundo';
    fundo.innerHTML = `
      <div class="cf-caixa ${perigo ? 'cf-perigo' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="cf-titulo" aria-describedby="cf-msg">
        <h2 id="cf-titulo"></h2>
        <p id="cf-msg"></p>
        <div class="cf-acoes">
          <button type="button" class="btn btn-secondary" data-cf="nao"></button>
          <button type="button" class="btn ${perigo ? 'cf-btn-perigo' : 'btn-primary'}" data-cf="sim"></button>
        </div>
      </div>`;
    fundo.querySelector('#cf-titulo').textContent = titulo;
    fundo.querySelector('#cf-msg').textContent = mensagem;
    fundo.querySelector('[data-cf="nao"]').textContent = cancelar;
    fundo.querySelector('[data-cf="sim"]').textContent = confirmar;
    document.body.appendChild(fundo);

    const fechar = (resposta) => {
      document.removeEventListener('keydown', teclas, true);
      fundo.remove();
      if (voltarFoco && typeof voltarFoco.focus === 'function') voltarFoco.focus({ preventScroll: true });
      resolve(resposta);
    };
    const botoes = [...fundo.querySelectorAll('button')];
    const teclas = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(false); }
      else if (e.key === 'Tab') { // mantém o foco dentro da caixa
        const i = botoes.indexOf(document.activeElement);
        e.preventDefault();
        botoes[(i + (e.shiftKey ? -1 : 1) + botoes.length) % botoes.length].focus();
      }
    };
    document.addEventListener('keydown', teclas, true);
    fundo.addEventListener('click', (e) => {
      if (e.target === fundo) return fechar(false);
      const b = e.target.closest('[data-cf]');
      if (b) fechar(b.dataset.cf === 'sim');
    });
    // Em ação perigosa o foco começa no "Cancelar", para um Enter distraído não excluir nada
    (perigo ? botoes[0] : botoes[1]).focus();
  });
}
