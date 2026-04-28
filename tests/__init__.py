import sys
from pathlib import Path

# Добавляем корень проекта в системные пути
# Это заставит Python видеть папку 'app'
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))