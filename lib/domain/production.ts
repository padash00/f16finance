// Restaurant Production — расчёт себестоимости техкарты (food cost). Чистая логика.
//
// portion_cost = Σ(component_qty × (1 + waste%) × unit_cost) / (output_qty × yield_factor)
//   unit_cost: для ингредиента — закупочная цена за ед. (inventory_items.default_purchase_price);
//              для полуфабриката — portion_cost вложенной техкарты.
// yield_factor < 1 = технологические потери выхода (напр. 0.97 = 3% ужарки).

export type RecipeComponent = {
  ingredient_id?: string | null
  component_recipe_id?: string | null
  name?: string | null
  qty: number
  unit?: string | null
  waste_pct?: number | null
}

export type Recipe = {
  id: string
  output_qty: number
  yield_factor: number
  components: RecipeComponent[]
}

export type RecipeCost = {
  recipeCost: number // себестоимость всего выхода
  portionCost: number // на единицу выхода (порцию/кг)
  components: Array<{ name: string; cost: number }>
}

export function computeRecipeCost(params: {
  recipe: Recipe
  ingredientCostById: Map<string, number>
  nestedPortionCostById: Map<string, number>
}): RecipeCost {
  const { recipe, ingredientCostById, nestedPortionCostById } = params
  let total = 0
  const components: Array<{ name: string; cost: number }> = []

  for (const c of recipe.components || []) {
    const wasteMul = 1 + (Number(c.waste_pct) || 0) / 100
    let unitCost = 0
    if (c.ingredient_id) unitCost = ingredientCostById.get(String(c.ingredient_id)) || 0
    else if (c.component_recipe_id) unitCost = nestedPortionCostById.get(String(c.component_recipe_id)) || 0
    const cost = (Number(c.qty) || 0) * wasteMul * unitCost
    total += cost
    components.push({ name: String(c.name || c.ingredient_id || c.component_recipe_id || '—'), cost })
  }

  const outputQty = Number(recipe.output_qty) || 1
  const yieldFactor = Number(recipe.yield_factor) || 1
  const netOutput = outputQty * yieldFactor
  const portionCost = netOutput > 0 ? total / netOutput : 0

  return { recipeCost: total, portionCost, components }
}

/**
 * Резолвит portion_cost для всех техкарт с учётом вложенных полуфабрикатов
 * (рекурсивно, с защитой от циклов и мемоизацией).
 */
export function resolveAllRecipeCosts(params: {
  recipes: Recipe[]
  ingredientCostById: Map<string, number>
}): Map<string, RecipeCost> {
  const { recipes, ingredientCostById } = params
  const byId = new Map(recipes.map((r) => [String(r.id), r]))
  const memo = new Map<string, RecipeCost>()
  const inProgress = new Set<string>()

  function resolve(id: string): RecipeCost {
    if (memo.has(id)) return memo.get(id)!
    const recipe = byId.get(id)
    if (!recipe || inProgress.has(id)) {
      // цикл или нет рецепта → нулевая стоимость, не падаем
      return { recipeCost: 0, portionCost: 0, components: [] }
    }
    inProgress.add(id)
    const nested = new Map<string, number>()
    for (const c of recipe.components || []) {
      if (c.component_recipe_id) {
        nested.set(String(c.component_recipe_id), resolve(String(c.component_recipe_id)).portionCost)
      }
    }
    inProgress.delete(id)
    const cost = computeRecipeCost({ recipe, ingredientCostById, nestedPortionCostById: nested })
    memo.set(id, cost)
    return cost
  }

  for (const r of recipes) resolve(String(r.id))
  return memo
}
