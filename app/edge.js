document.querySelector('button').addEventListener('click', () => window.marginEdge.open());
window.marginEdge.onSide(side => document.body.classList.toggle('left', side === 'left'));
