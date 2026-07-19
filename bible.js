// bible.js — Módulo Biblia RVR60
// Descarga los datos de la Biblia una sola vez y los guarda en IndexedDB para uso offline.

const BIBLE_URL = 'https://cdn.jsdelivr.net/gh/thiagobodruk/bible@master/json/es_rvr.json';

const bible = {
  data: null,        // array de libros
  loading: false,
  loaded: false,

  BOOK_NAMES: [
    'Génesis','Éxodo','Levítico','Números','Deuteronomio','Josué','Jueces','Rut',
    '1 Samuel','2 Samuel','1 Reyes','2 Reyes','1 Crónicas','2 Crónicas','Esdras',
    'Nehemías','Ester','Job','Salmos','Proverbios','Eclesiastés','Cantares','Isaías',
    'Jeremías','Lamentaciones','Ezequiel','Daniel','Oseas','Joel','Amós','Abdías',
    'Jonás','Miqueas','Nahúm','Habacuc','Sofonías','Hageo','Zacarías','Malaquías',
    'Mateo','Marcos','Lucas','Juan','Hechos','Romanos','1 Corintios','2 Corintios',
    'Gálatas','Efesios','Filipenses','Colosenses','1 Tesalonicenses','2 Tesalonicenses',
    '1 Timoteo','2 Timoteo','Tito','Filemón','Hebreos','Santiago','1 Pedro','2 Pedro',
    '1 Juan','2 Juan','3 Juan','Judas','Apocalipsis'
  ],

  OT_COUNT: 39,  // primeros 39 libros = Antiguo Testamento

  async load(onProgress) {
    if (this.loaded) return true;
    if (this.loading) return false;
    this.loading = true;

    // Intentar desde caché IndexedDB
    try {
      const cached = await bibleCache.get();
      if (cached && Array.isArray(cached) && cached.length >= 66) {
        this.data = cached;
        this.loaded = true;
        this.loading = false;
        return true;
      }
    } catch (e) {}

    // Descargar
    try {
      if (onProgress) onProgress('Descargando Biblia RVR60...');
      const res = await fetch(BIBLE_URL);
      if (!res.ok) throw new Error('Error de red');
      const raw = await res.json();

      // Normalizar estructura del JSON
      // El formato de thiagobodruk es: [{book, chapters: [[v1,v2,...], ...]}]
      this.data = this._normalize(raw);

      // Guardar en caché
      if (onProgress) onProgress('Guardando para uso offline...');
      await bibleCache.set(this.data);
      this.loaded = true;
      this.loading = false;
      return true;
    } catch (e) {
      this.loading = false;
      return false;
    }
  },

  _normalize(raw) {
    // Si ya tiene el formato correcto, usarlo tal cual
    if (Array.isArray(raw) && raw[0] && raw[0].chapters) {
      return raw.map((book, i) => ({
        name: this.BOOK_NAMES[i] || book.book || book.name || `Libro ${i + 1}`,
        chapters: book.chapters,
      }));
    }
    return raw;
  },

  getBook(bookIndex) {
    if (!this.data || !this.data[bookIndex]) return null;
    return this.data[bookIndex];
  },

  getChapter(bookIndex, chapterIndex) {
    const book = this.getBook(bookIndex);
    if (!book || !book.chapters[chapterIndex]) return [];
    return book.chapters[chapterIndex];
  },

  getVerse(bookIndex, chapterIndex, verseIndex) {
    const ch = this.getChapter(bookIndex, chapterIndex);
    return ch[verseIndex] || '';
  },

  // Construir el texto para proyección
  buildVersePayload(bookIndex, chapterIndex, verseStart, verseEnd) {
    const book = this.getBook(bookIndex);
    const chapter = this.getChapter(bookIndex, chapterIndex);
    const start = Math.min(verseStart, verseEnd);
    const end = Math.max(verseStart, verseEnd);
    const verses = chapter.slice(start, end + 1);
    const text = verses.map((v, i) => `${start + i + 1} ${v}`).join('\n');
    const reference = `${book.name} ${chapterIndex + 1}:${start + 1}${end > start ? '-' + (end + 1) : ''}`;
    return { kind: 'verse', text, reference };
  },
};
