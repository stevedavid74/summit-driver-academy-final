const params = new URLSearchParams(window.location.search);
const tier = params.get('tier');
const price = Number(params.get('price'));
const reference = params.get('reference');
const french = document.documentElement.lang === 'fr';

if ((tier === 'founding' || tier === 'regular') && (price === 900 || price === 1200)) {
  const tierLabel = french
    ? (tier === 'founding' ? 'Tarif des 30 fondateurs' : 'Tarif régulier')
    : (tier === 'founding' ? 'Founding 30 tuition' : 'Regular tuition');
  const amount = french ? `${price.toLocaleString('fr-CA')} $` : `$${price.toLocaleString('en-CA')}`;
  document.querySelector('#tuition-confirmation').textContent =
    `${tierLabel}: ${amount} + ${french ? 'taxes applicables' : 'applicable taxes'}.`;
}

if (reference) {
  document.querySelector('#registration-reference').textContent =
    `${french ? 'Référence' : 'Reference'}: ${reference}`;
}
