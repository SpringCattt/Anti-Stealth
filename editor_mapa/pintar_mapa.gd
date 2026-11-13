@tool
extends GridMap
# Pinta el mapa táctico en este GridMap. Crea su propia biblioteca de bloques con los colores de TIPOS.
# Flujo: "pintar" carga archivo_mapa en el GridMap -> editas los bloques a mano -> "exportar" lo escribe de vuelta.

# Mapa que se carga y se exporta, relativo a este proyecto (res://). La simulación usa ../mapa_casa.js.
@export var archivo_mapa: String = "../mapa_casa.js"

# Marca "pintar" en el Inspector: pinta el mapa y vuelve a false.
@export var pintar: bool = false:
	set(valor):
		if valor and is_inside_tree():
			call_deferred("pintar_mapa")  # espera a que los colores estén cargados
		pintar = false

# Marca "exportar" en el Inspector: escribe archivo_mapa desde las celdas pintadas y vuelve a false.
@export var exportar: bool = false:
	set(valor):
		if valor and is_inside_tree():
			call_deferred("exportar_mapa")
		exportar = false

const ALTURA_PARED := 3  # cubos de altura de los muros
const ESCALA := 1        # cada casilla del diseño son ESCALA x ESCALA bloques (pasillos más anchos)

# Colores de cada bloque: cámbialos en el Inspector sin tocar código
@export_group("Colores de bloques")
@export var color_muro: Color = Color(0.27, 0.27, 0.25)
@export var color_suelo: Color = Color(0.83, 0.82, 0.78)
@export var color_hierba: Color = Color(0.59, 0.77, 0.35)
@export var color_botin: Color = Color(0.94, 0.62, 0.15)
@export var color_caja: Color = Color(0.89, 0.29, 0.29)
@export var color_spawn: Color = Color(0.22, 0.54, 0.87)
@export var color_extraccion: Color = Color(0.12, 0.62, 0.46)
@export var color_guardian: Color = Color(0.9, 0.5, 0.1)
@export var color_caja_baja: Color = Color(0.55, 0.43, 0.29)
@export_group("")

# Tipos de bloque: código de casilla -> [nombre, color]. Se construye desde los colores de arriba.
func _tipos() -> Dictionary:
	return {
		"#": ["muro", color_muro],
		".": ["suelo", color_suelo],
		"g": ["hierba", color_hierba],
		"B": ["botin", color_botin],
		"C": ["caja", color_caja],
		"S": ["spawn", color_spawn],
		"E": ["extraccion", color_extraccion],
		"G": ["guardian", color_guardian],
		"c": ["caja_baja", color_caja_baja],  # se pinta en y = 1 encima del suelo (altura 1: tapa al agachado)
	}

# Ruta absoluta de archivo_mapa.
func _ruta_mapa() -> String:
	if archivo_mapa.is_absolute_path():
		return archivo_mapa
	return ProjectSettings.globalize_path("res://").path_join(archivo_mapa).simplify_path()

# Filas del diseño (una String por fila, un carácter por casilla) leídas de archivo_mapa: cada fila de celdas es
# una línea "[\"#\",\"g\",...]". Si no se puede leer, usa la copia de reserva MAPA de abajo.
func _filas_diseno() -> PackedStringArray:
	var archivo := FileAccess.open(_ruta_mapa(), FileAccess.READ)
	if archivo == null:
		push_warning("pintar_mapa: no se pudo leer %s; uso la copia MAPA del script" % _ruta_mapa())
		return MAPA.strip_edges().split("\n")
	var filas := PackedStringArray()
	for linea in archivo.get_as_text().split("\n"):
		var l := linea.strip_edges().trim_suffix(",")
		if not l.begins_with("[\""):
			continue
		var celdas = JSON.parse_string(l)
		if celdas is Array:
			filas.append("".join(PackedStringArray(celdas)))
	return filas

# Copia de reserva (mapa antiguo, el de mapa_diseno.txt) por si archivo_mapa no existe.
const MAPA := """
##########################################################################################
#gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
#gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
#ggggggggggggggggggggggggggggggggggggggg#gggggggggggggggggggggggggggggggggggggggggggggggg#
#ggg#######ggggggggggggggggggggggggggggg#ggggggggggggggggggggggggggggggggggg#gggggggggggg#
#ggggggggggggggggggg###########ggggggggg#ggggggggggggggg###########ggggggggg#gggggggggggg#
#ggggggggggggggggggggggggggggggggggggggg#ggggggggggggggggggggggggggggggggggg#gggggggggggg#
#ggggggggggggggggggggggggggggggggggggggg#ggggggggggggggggggggggggggggggggggg#gggggggggggg#
#ggggggggggggggggggggggggggggggggggggggg#ggggggg##gggggggggggggggggggg#######gggggggggggg#
#gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
#gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
#gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
#ggggggggggggggg###..#######################..###############..###########ggggggggggggggg#
#ggggggggggggggg#.......#...#....#........#....#.........#........#......#ggggggggggggggg#
#ggggggggggggggg#.......#...#....#........#....#.........#........#......#ggggggggggggggg#
#ggggggggggggggg#..B....#...#.............#....#.........#...........##..#ggggggggggggggg#
#gggggg#gggggggg#.......#...#........##...#....#.........#...##..........#gggggggg#gggggg#
#gggggg#gggggggg#....#..#..##....#.......................#........#.......gggggggg#gggggg#
#gggggg#gggggggg#....#...........#....................#..#........#.......gggggggg#gggggg#
#gggggg#gggggggg#.............#..#........#....#..#...............#......#gggggggg#gggggg#
#gggggg#gggggggg#.......#........#........#....#..................#......#gggggggg#gggggg#
#gggggg#ggg#gggg#.......#........#........#....#.........#........#......#gggg#ggg#gggggg#
#gggggg#ggg#gggg###..########..#######..###....###..########..############gggg#ggg#gggggg#
#gggggg#ggg#gggg#........#........#....................#........#........#gggg#ggg#gggggg#
#gggggg#gggggggg#........#........#....................#..............GGG#gggggggg#gggggg#
#gggggg#gggggggg.........#...##...#..##..##....##..##..#..............GGG#gggggggg#gggggg#
#gggggg#gggggggg....##...............#..............#.......##..#..##....#gggggggg#gggggg#
#ggggggggggggggg#...............................................#........#ggggggggggggggg#
#ggggggggggggggg#........#........#.....##......##.....#........#........#ggggggggggggggg#
#ggggggggggggggg####..#############..#..............#..###..#########..###ggggggggggggggg#
#ggggggggggggggg..........................................................ggggggggggggggg#
#ggggggggggggggg.............................B............................ggggggggggggggg#
#ggggggggggggggg..........................................................ggggggggggggggg#
#ggggggggggggggg..........................................................ggggggggggggggg#
#ggggggggggggggg######..######..###..#..............#..###..#######..#####ggggggggggggggg#
#ggggggggggggggg#..........#......#.....##......##.....#......#..........#ggggggggggggggg#
#ggggggggggggggg#..........#......#....................#......#..........#ggggggggggggggg#
#gggggg#gggggggg.....##..............#..............#.....................gggggggg#gggggg#
#gggggg#gggggggg..............#......##..##....##..##.............##......gggggggg#gggggg#
#gggggg#gggggggg#..........#......#....................#......#..........#gggggggg#gggggg#
#gggggg#ggg#gggg#..........#......#....................#......#..........#gggg#ggg#gggggg#
#gggggg#ggg#gggg####..########..######..###....###..########..#######..###gggg#ggg#gggggg#
#gggggg#ggg#gggg#..........#.......#......#....#........#........#.......#gggg#ggg#gggggg#
#gggggg#gggggggg...........#.......#......#....#.................#.......#gggggggg#gggggg#
#gggggg#gggggggg.......##..#..............#..............................#gggggggg#gggggg#
#gggggg#gggggggg#..........#...#........................#................#gggggggg#gggggg#
#gggggg#gggggggg##..##.........#...#...........#........##..##...#..##....gggggggg#gggggg#
#gggggg#gggggggg#....#.............#......#....#...##...#....#...#........gggggggg#gggggg#
#ggggggggggggggg#....#.....#.......#..##..#....#........#....#...#....B..#ggggggggggggggg#
#ggggggggggggggg#....#.....#.......#......#....#........#....#...#.......#ggggggggggggggg#
#ggggggggggggggg#....#.....#.......#......#....#........#....#...#.......#ggggggggggggggg#
#ggggggggggggggg######.#######..###########...#################.##########ggggggggggggggg#
#gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
#gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
#ggggggggggggggggggggggggggggggggggggggg#ggggggggggggggggggggggggggggggggggg#gggggggggggg#
#ggggggggggggg#ggggggggggggggggggggggggg#ggggggggggggggggggggggggggggggggggg#gggggggggggg#
#ggggggggggggg#ggggggg###########ggggggg#ggggggggggggggg###########ggggggggg#gggggggggggg#
#ggggggggggggg#ggggggggggggggggggggggggg#gggggggg##ggggggggggggggggggggggggg#gggggggggggg#
#ggggggggggggg#ggggggggggggggggggggggggg#ggggggggggggggggggggggggggggggggggg#########gggg#
#ggggggg#######ggggggggggggggggggggggggg#gggggggggggggggggggggggggggggggggggggggggggggggg#
#gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
#SSSggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
#SSSggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg#
##########################################################################################
"""


func pintar_mapa() -> void:
	clear()  # repintar es seguro

	# Biblioteca propia: un bloque por tipo, con su color
	var biblioteca := MeshLibrary.new()
	var id_de: Dictionary = {}
	var id := 0
	var tipos := _tipos()
	for codigo in tipos:
		var caja := BoxMesh.new()
		var material := StandardMaterial3D.new()
		material.albedo_color = tipos[codigo][1]
		caja.material = material
		biblioteca.create_item(id)
		biblioteca.set_item_name(id, tipos[codigo][0])
		biblioteca.set_item_mesh(id, caja)
		id_de[codigo] = id
		id += 1
	mesh_library = biblioteca

	var filas: PackedStringArray = _filas_diseno()
	var ancho: int = filas[0].strip_edges().length()
	var conteo: Dictionary = {}
	var marcadores: Dictionary = {"B": [], "C": [], "S": [], "E": [], "G": []}

	for z in filas.size():
		var fila: String = filas[z].strip_edges()  # quita \r si el archivo tiene CRLF
		if fila.length() != ancho:
			push_error("pintar_mapa: la fila %d mide %d, se esperaba %d" % [z, fila.length(), ancho])
		for x in fila.length():
			var c: String = fila[x]
			conteo[c] = conteo.get(c, 0) + 1
			if marcadores.has(c):
				marcadores[c].append(Vector2i(x, z))
			# Cada casilla del diseño ocupa ESCALA x ESCALA bloques en el suelo
			var suelo_id: int = id_de["."] if c == "#" or c == "c" else id_de.get(c, id_de["."])
			for dz in ESCALA:
				for dx in ESCALA:
					set_cell_item(Vector3i(x * ESCALA + dx, 0, z * ESCALA + dz), suelo_id)
					# Muros apilados encima del suelo
					if c == "#":
						for y in range(1, ALTURA_PARED + 1):
							set_cell_item(Vector3i(x * ESCALA + dx, y, z * ESCALA + dz), id_de["#"])
					# Caja baja: un bloque encima del suelo
					elif c == "c":
						set_cell_item(Vector3i(x * ESCALA + dx, 1, z * ESCALA + dz), id_de["c"])

	# Resumen en la consola (coordenadas del diseño, no de bloques)
	print("Mapa pintado desde %s: %d x %d casillas de diseño -> %d x %d bloques" % [_ruta_mapa(), ancho, filas.size(), ancho * ESCALA, filas.size() * ESCALA])
	for codigo in conteo:
		print("  '%s': %d casillas" % [codigo, conteo[codigo]])
	for k in marcadores:
		print("  %s en (x, z) del diseño: %s" % [k, str(marcadores[k])])


# Lee las celdas del GridMap (fuente de verdad) y escribe archivo_mapa con el formato de MAPA_DISENO.
# Casilla: '#' si tiene un bloque "muro" en cualquier y; si no, 'c' si tiene otro bloque en y > 0 (caja baja);
# si no, el código del bloque en y = 0 ('.', 'g' o un marcador B C S G E). Sin ningún bloque: '#'.
@warning_ignore("integer_division")
func exportar_mapa() -> void:
	if mesh_library == null:
		push_error("exportar_mapa: el GridMap no tiene MeshLibrary")
		return
	var usadas: Array[Vector3i] = get_used_cells()
	if usadas.is_empty():
		push_error("exportar_mapa: no hay celdas pintadas")
		return

	# Nombre del item -> código de diseño (lo inverso de _tipos())
	var codigo_de: Dictionary = {}
	var tipos := _tipos()
	for codigo in tipos:
		codigo_de[tipos[codigo][0]] = codigo

	# La esquina mínima de lo pintado es la casilla (0, 0) del diseño
	var x0: int = usadas[0].x
	var z0: int = usadas[0].z
	var x1: int = x0
	var z1: int = z0
	for c in usadas:
		x0 = mini(x0, c.x)
		x1 = maxi(x1, c.x)
		z0 = mini(z0, c.z)
		z1 = maxi(z1, c.z)
	var ancho: int = (x1 - x0) / ESCALA + 1
	var alto: int = (z1 - z0) / ESCALA + 1

	var muros: Dictionary = {}  # Vector2i -> true
	var bajos: Dictionary = {}  # Vector2i -> true (bloque que no es muro en y > 0)
	var suelo: Dictionary = {}  # Vector2i -> código del bloque en y = 0
	var desconocidos: Dictionary = {}
	for c in usadas:
		var p := Vector2i((c.x - x0) / ESCALA, (c.z - z0) / ESCALA)
		var nombre: String = mesh_library.get_item_name(get_cell_item(c))
		if not codigo_de.has(nombre):
			desconocidos[nombre] = desconocidos.get(nombre, 0) + 1
			continue
		if codigo_de[nombre] == "#":
			muros[p] = true
		elif c.y > 0:
			bajos[p] = true
		elif c.y == 0:
			suelo[p] = codigo_de[nombre]

	# Matriz fila a fila (z) y marcadores en el mismo orden
	var marcadores: Dictionary = {"B": [], "C": [], "S": [], "E": [], "G": []}
	var conteo: Dictionary = {}
	var filas := PackedStringArray()
	var vacias := 0
	for z in alto:
		var fila := PackedStringArray()
		for x in ancho:
			var p := Vector2i(x, z)
			var codigo: String = "#"  # muro o casilla sin bloques
			if not muros.has(p):
				if bajos.has(p):
					codigo = "c"
				elif suelo.has(p):
					codigo = suelo[p]
				else:
					vacias += 1
			conteo[codigo] = conteo.get(codigo, 0) + 1
			if marcadores.has(codigo):
				marcadores[codigo].append("[%d,%d]" % [x, z])
			fila.append("\"%s\"" % codigo)
		filas.append("    [" + ",".join(fila) + "]")
	# Sin casillas de extracción se sale por el spawn (S es también la extracción)
	if marcadores["E"].is_empty():
		marcadores["E"] = marcadores["S"].duplicate()

	var texto := "// Mapa táctico exportado desde editor_mapa/mapa.tscn (pintar_mapa.gd, casilla exportar). Acceso: MAPA_DISENO.celdas[z][x]\n"
	texto += "// Se edita en Godot: abre editor_mapa, marca 'pintar', cambia bloques y marca 'exportar'.\n"
	texto += "// Códigos: '#' pared, '.' suelo, 'g' hierba, 'c' caja baja (bloque no muro en y > 0), 'B' botín, 'C' caja fuerte, 'S' spawn infiltradores, 'G' spawn guardianes, 'E' extracción.\n"
	texto += "const MAPA_DISENO = {\n  ancho: %d,\n  alto: %d,\n  celdas: [\n" % [ancho, alto]
	texto += ",\n".join(filas) + "\n  ],\n  marcadores: {\n"
	var lineas := PackedStringArray()
	for k in marcadores:
		lineas.append("    %s: [%s]" % [k, ",".join(PackedStringArray(marcadores[k]))])
	texto += ",\n".join(lineas) + "\n  }\n};\n"

	var ruta := _ruta_mapa()
	var archivo := FileAccess.open(ruta, FileAccess.WRITE)
	if archivo == null:
		push_error("exportar_mapa: no se pudo abrir %s (%s)" % [ruta, error_string(FileAccess.get_open_error())])
		return
	archivo.store_string(texto)
	archivo.close()

	# Resumen en la consola
	print("Mapa exportado: %d x %d casillas -> %s" % [ancho, alto, ruta])
	for codigo in conteo:
		print("  '%s': %d casillas" % [codigo, conteo[codigo]])
	for k in marcadores:
		print("  %s en [x, z]: %s" % [k, ",".join(PackedStringArray(marcadores[k]))])
	if vacias > 0:
		push_warning("exportar_mapa: %d casillas sin bloques, exportadas como '#'" % vacias)
	if not desconocidos.is_empty():
		push_warning("exportar_mapa: items sin código, ignorados: %s" % str(desconocidos))
	for k in ["G", "S", "B"]:
		if marcadores[k].is_empty():
			push_warning("exportar_mapa: no hay ninguna casilla '%s'; la simulación la necesita" % k)
