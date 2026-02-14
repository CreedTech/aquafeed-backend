import json
import os

def audit_ingredients(file_path):
    with open(file_path, 'r') as f:
        ingredients = json.load(f)

    print(f"Auditing {len(ingredients)} ingredients...")
    
    issues = []
    
    for ing in ingredients:
        name = ing.get('name', 'UNKNOWN')
        nutrients = ing.get('nutrients', {})
        
        # Key nutrients that should usually not be zero for most ingredients
        # except specific minerals/fillers
        checks = ['protein', 'fat', 'fiber', 'energy', 'lysine', 'methionine', 'calcium', 'phosphorous']
        
        missing = [c for c in checks if c not in nutrients]
        zeros = [c for c in checks if nutrients.get(c) == 0]
        
        if missing or zeros:
            issue = {
                "name": name,
                "missing": missing,
                "zeros": zeros,
                "category": ing.get('category')
            }
            issues.append(issue)

    print("\n--- Audit Results ---")
    for issue in issues:
        print(f"Ingredient: {issue['name']} ({issue['category']})")
        if issue['missing']:
            print(f"  MISSING: {', '.join(issue['missing'])}")
        if issue['zeros']:
            print(f"  ZEROS: {', '.join(issue['zeros'])}")
        print("-" * 20)

    print(f"\nTotal ingredients with issues: {len(issues)}")

if __name__ == "__main__":
    audit_ingredients('/Users/ayoola/Documents/aquafeed/ingredients_data.json')
