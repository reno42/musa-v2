import re

file_path = r'C:\Users\Renzo\.openclaw\workspace\Batch-a-mator\code.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("t.name = `#Texto${textIndex}`;", "t.name = `#Unico${textIndex}`;")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)

ui_path = r'C:\Users\Renzo\.openclaw\workspace\Batch-a-mator\ui.html'
with open(ui_path, 'r', encoding='utf-8') as f:
    ui = f.read()

ui = ui.replace("(#Texto1, #Texto2...)", "(#Unico1, #Unico2...)")
ui = ui.replace("Texto1,Texto2,Texto3", "Unico1,Unico2,Unico3")
ui = ui.replace("<strong>Texto1</strong>, <strong>Texto2</strong>", "<strong>Unico1</strong>, <strong>Unico2</strong>")

with open(ui_path, 'w', encoding='utf-8') as f:
    f.write(ui)

csv1_path = r'C:\Users\Renzo\.openclaw\workspace\Batch-a-mator\csv_templates\1_Post_Unico.csv'
with open(csv1_path, 'w', encoding='utf-8') as f:
    f.write('Unico1,Unico2,Unico3\n"¡Lanzamiento exclusivo!","Descubre el nuevo plugin que automatiza todo","Descarga ahora"\n"Ahorra horas de trabajo","Deja de copiar y pegar en Figma","Ver tutorial"\n"Batch-a-mator 1.0","La herramienta definitiva para creadores","Pruébalo gratis"')
