figma.showUI(__html__, { width: 400, height: 600 });

// HELPER: Find all text nodes recursively
function findTextNodes(node: SceneNode): TextNode[] {
  let texts: TextNode[] = [];
  if (node.type === 'TEXT') {
    texts.push(node);
  } else if ('children' in node) {
    for (const child of node.children) {
      texts = texts.concat(findTextNodes(child));
    }
  }
  return texts;
}

// Auto-Rename Logic
function autoRename(mode: string) {
  const selection = figma.currentPage.selection;
  const frames = selection.filter(n => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE') as FrameNode[];

  if (frames.length === 0) {
    figma.ui.postMessage({ type: 'status', message: 'Selecciona al menos 1 Frame', statusType: 'error' });
    return;
  }

  // 1. Group frames by row (Y-axis proximity)
  frames.sort((a, b) => a.y - b.y);
  const rows: FrameNode[][] = [];
  let currentRow: FrameNode[] = [];
  let currentY = frames[0].y;

  for (const frame of frames) {
    if (Math.abs(frame.y - currentY) > 200) { // threshold
      rows.push(currentRow);
      currentRow = [];
      currentY = frame.y;
    }
    currentRow.push(frame);
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // 2. Sort each row by X
  rows.forEach(r => r.sort((a, b) => a.x - b.x));

  // 3. Rename Frames and internal texts
  let carruselIndex = 1;
  let plantillaIndex = 1;
  let postIndex = 1;

  for (const row of rows) {
    // If Mode 3 (Carruseles), each row is a different carousel. The frames are slides.
    let slideIndex = 1;
    
    for (const frame of row) {
      if (mode === 'carrusel') {
        frame.name = `Carrusel_${carruselIndex}_Slide_${slideIndex}`;
      } else if (mode === 'variable') {
        frame.name = `Plantilla_${plantillaIndex}`;
      } else if (mode === 'unico') {
        frame.name = `PostTemplate_${postIndex}`;
      }

      // Rename internal texts (top to bottom, left to right)
      const texts = findTextNodes(frame);
      texts.sort((a, b) => {
        if (Math.abs(a.y - b.y) > 20) return a.y - b.y; // sort by Y first
        return a.x - b.x; // then X
      });

      let textIndex = 1;
      for (const t of texts) {
        if (mode === 'carrusel') t.name = `#Carrusel${textIndex}`;
        else if (mode === 'variable') t.name = `#Variable${textIndex}`;
        else if (mode === 'unico') t.name = `#Unico${textIndex}`;
        textIndex++;
      }

      slideIndex++;
      plantillaIndex++;
      postIndex++;
    }
    carruselIndex++;
  }

  figma.ui.postMessage({ type: 'status', message: '¡Capas renombradas mágicamente!', statusType: 'success' });
}

// Load fonts before filling
async function loadFontsForNodes(nodes: TextNode[]) {
  const fonts = new Set<string>();
  for (const n of nodes) {
    if (n.fontName !== figma.mixed) {
      fonts.add(JSON.stringify(n.fontName));
    }
  }
  for (const f of fonts) {
    try { await figma.loadFontAsync(JSON.parse(f)); } catch(e){}
  }
}

figma.ui.onmessage = async (msg: any) => {
  
  if (msg.type === 'auto-rename') {
    autoRename(msg.mode);
    return;
  }

  // --- MODE 1: POST ÚNICO ---
  if (msg.type === 'generate-mode1') {
    const selection = figma.currentPage.selection;
    if (selection.length !== 1 || selection[0].type !== 'FRAME') {
      figma.ui.postMessage({ type: 'status', message: 'Selecciona 1 Frame como plantilla.', statusType: 'error' });
      return;
    }
    const template = selection[0] as FrameNode;
    const data = msg.data; // [{Texto1: "hola", Texto2: "mundo"}]

    const allTexts = findTextNodes(template);
    await loadFontsForNodes(allTexts);

    let startY = template.y + template.height + 100;
    const newNodes: SceneNode[] = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const clone = template.clone();
      clone.y = startY;
      clone.name = `${template.name} - ${i+1}`;
      startY += clone.height + 100;

      const cloneTexts = findTextNodes(clone);
      for (const t of cloneTexts) {
        const colName = t.name.replace('#', '');
        if (row[colName] !== undefined && row[colName] !== '') {
          try { t.characters = row[colName]; } catch(e){}
        }
      }
      newNodes.push(clone);
    }
    figma.currentPage.selection = newNodes;
    figma.viewport.scrollAndZoomIntoView(newNodes);
    figma.ui.postMessage({ type: 'status', message: `¡${data.length} Posts Generados!`, statusType: 'success' });
    return;
  }


  // --- MODE 2: MULTI POSTS ---
  if (msg.type === 'generate-mode2') {
    const data = msg.data; // [{Plantilla: "Plantilla_1", Variable1: "Hola"}]
    const newNodes: SceneNode[] = [];
    
    // We will place them below the highest node to avoid overlap, or just at a specific offset.
    let startY = 0;
    let startX = 0;
    if (figma.currentPage.children.length > 0) {
      const last = figma.currentPage.children[figma.currentPage.children.length-1];
      startY = last.y + last.height + 100;
      startX = last.x;
    }

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const templateName = row['Plantilla'];
      if (!templateName) continue;

      const template = figma.currentPage.findOne(n => n.name === templateName && n.type === 'FRAME') as FrameNode;
      if (!template) {
        console.warn(`Plantilla no encontrada: ${templateName}`);
        continue;
      }

      await loadFontsForNodes(findTextNodes(template));

      const clone = template.clone();
      clone.x = startX;
      clone.y = startY;
      clone.name = `${templateName} - Generado ${i+1}`;
      startY += clone.height + 100;

      const cloneTexts = findTextNodes(clone);
      for (const t of cloneTexts) {
        const colName = t.name.replace('#', '');
        if (row[colName] !== undefined && row[colName] !== '') {
          try { t.characters = row[colName]; } catch(e){}
        }
      }
      newNodes.push(clone);
    }
    if (newNodes.length > 0) {
      figma.currentPage.selection = newNodes;
      figma.viewport.scrollAndZoomIntoView(newNodes);
      figma.ui.postMessage({ type: 'status', message: `¡${newNodes.length} Posts Múltiples Generados!`, statusType: 'success' });
    } else {
      figma.ui.postMessage({ type: 'status', message: `No se encontró ninguna plantilla.`, statusType: 'error' });
    }
    return;
  }


  // --- MODE 3: CARRUSELES ---
  if (msg.type === 'generate-mode3') {
    const data = msg.data; // [{ID_Carrusel: "1", Plantilla_Slide: "Slide1", Carrusel1: "Hola"}]
    const newNodes: SceneNode[] = [];
    
    let currentY = 0;
    if (figma.currentPage.children.length > 0) {
      const last = figma.currentPage.children[figma.currentPage.children.length-1];
      currentY = last.y + last.height + 200;
    }

    // Group by ID_Carrusel
    const carruseles: Record<string, any[]> = {};
    for (const row of data) {
      const id = row['ID_Carrusel'];
      if (!id) continue;
      if (!carruseles[id]) carruseles[id] = [];
      carruseles[id].push(row);
    }

    for (const id in carruseles) {
      const slides = carruseles[id];
      let currentX = 0;
      let maxHeight = 0;

      for (let i = 0; i < slides.length; i++) {
        const row = slides[i];
        const templateName = row['Plantilla_Slide'];
        if (!templateName) continue;

        const template = figma.currentPage.findOne(n => n.name === templateName && n.type === 'FRAME') as FrameNode;
        if (!template) continue;

        await loadFontsForNodes(findTextNodes(template));

        const clone = template.clone();
        clone.x = currentX;
        clone.y = currentY;
        clone.name = `Generado_Carrusel_${id}_Slide_${i+1}`;
        
        if (clone.height > maxHeight) maxHeight = clone.height;
        currentX += clone.width + 50; // space between slides

        const cloneTexts = findTextNodes(clone);
        for (const t of cloneTexts) {
          const colName = t.name.replace('#', '');
          if (row[colName] !== undefined && row[colName] !== '') {
            try { t.characters = row[colName]; } catch(e){}
          }
        }
        newNodes.push(clone);
      }
      currentY += maxHeight + 200; // Move down for next carousel
    }

    if (newNodes.length > 0) {
      figma.currentPage.selection = newNodes;
      figma.viewport.scrollAndZoomIntoView(newNodes);
      figma.ui.postMessage({ type: 'status', message: `¡Carruseles Generados con Éxito!`, statusType: 'success' });
    } else {
      figma.ui.postMessage({ type: 'status', message: `No se encontraron plantillas.`, statusType: 'error' });
    }
    return;
  }

};
