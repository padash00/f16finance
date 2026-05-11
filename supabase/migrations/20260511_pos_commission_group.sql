-- =====================================================================
-- Группа pos_commission для категорий эквайринга / инкассации.
-- Раньше они были в operating — это создавало двойной счёт на странице
-- /profitability при заполнении ручного оборота POS × ставка %.
-- Теперь они идут отдельной строкой и страница сама решает: брать
-- журнальную сумму или ручную, но НЕ обе сразу.
-- =====================================================================

update public.expense_categories
set accounting_group = 'pos_commission'
where accounting_group in ('operating', 'financial_expenses')
  and (
    lower(name) like '%эквайринг%'
    or lower(name) like '%acquiring%'
    or lower(name) like '%инкассац%'
    or lower(name) like '%комиссия pos%'
    or lower(name) like '%комиссия банк%'
    or lower(name) like '%pos комисс%'
    or lower(name) like '%pos-комисс%'
  );
