export const DIACRITICS = {
  KASRA: '\u0650',
  SUKUN: '\u0652',
  SHADDA: '\u0651',
  DAGGER_ALIF: '\u0670', // الألف الخنجرية
  FATHA: '\u064E',
  DAMMA: '\u064F',
};

// فلتر الحروف العربية الأصلية
export function isArabicLetter(char) {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 0x0621 && code <= 0x063A) || (code >= 0x0641 && code <= 0x064A);
}

// === [الإضافة الجديدة] الدالة المسؤولة عن اكتشاف وتخطي علامات الوقف والرموز المخفية ===
export function isIgnoredChar(char) {
  if (!char) return false;
  return /[\u06D6-\u06DC\u06DD\u06DE\u06DF\u06E0\u06E2\u06E3\u06E5\u06E6\u06E8\u06E9\u06EA\u06EB\u06EC\u06ED\u06400-9\u0660-\u0669\u200C-\u200F\u202A-\u202E]/.test(char);
}

// القائمة السوداء (الرموز المستبعدة)
const SYMBOLS_TO_REMOVE = /[\u06D6-\u06DC\u06DD\u06DE\u06DF\u06E0\u06E2\u06E3\u06E5\u06E6\u06E8\u06E9\u06EA\u06EB\u06EC\u06ED\u06400-9\u0660-\u0669\u200C-\u200F\u202A-\u202E]/g;

export function cleanQuranText(text) {
  if (!text) return '';
  return text.replace(SYMBOLS_TO_REMOVE, '').trim();
}

export function isDiacritic(char) {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 0x064B && code <= 0x065F) || code === 0x0670;
}

// الدالة المحدثة بالقاعدة الذهبية للحركات وتخطي علامات الوقف
export function classifyYaaOrMaqsura(word, index, char) {
  // 1. إذا كان الحرف ياء صريحة بنقطتين، فهو حتماً ياء
  if (char === 'ي') return 'ي';

  // 2. التحقق من أنه في آخر الكلمة الفعلية واستخراج تشكيلاته
  let isEndOfWord = true;
  let currentDiacritics = [];
  
  // فحص ما بعد الحرف مع تخطي الرموز المخفية بذكاء
  for (let k = index + 1; k < word.length; k++) {
    if (isDiacritic(word[k])) {
      currentDiacritics.push(word[k]);
    } else if (isIgnoredChar(word[k])) {
      continue; // تخطي علامة الوقف وإكمال الفحص
    } else {
      isEndOfWord = false; // وجدنا حرفاً آخر، إذن هو في وسط أو أول الكلمة
      break;
    }
  }

  // 3. إذا لم يكن في آخر الكلمة -> فهو حتماً ياء
  if (!isEndOfWord) return 'ي';

  // ==========================================
  // 4. قواعد التفرقة الدقيقة للحرف الأخير
  // ==========================================

  // أ. إذا كان على الحرف نفسه ألف خنجرية -> ألف مقصورة (مثل: مُوسَىٰ)
  if (currentDiacritics.includes(DIACRITICS.DAGGER_ALIF)) {
    return 'ى';
  }

  // ب. القاعدة الذهبية: الألف المقصورة لا تقبل الحركات. 
  // إذا كان الحرف يحمل فتحة، ضمة، كسرة، سكون، أو شدة -> فهو حتماً "ي"
  const hasVowelOrSukun = currentDiacritics.some(d => 
    d === DIACRITICS.FATHA || 
    d === DIACRITICS.DAMMA || 
    d === DIACRITICS.KASRA || 
    d === DIACRITICS.SHADDA || 
    d === DIACRITICS.SUKUN
  );

  if (hasVowelOrSukun) {
    return 'ي';
  }

  // ج. استخراج الحرف السابق وتشكيلاته مع تخطي الرموز المخفية
  let prevCharIndex = index - 1;
  let prevDiacritics = [];
  
  while (prevCharIndex >= 0) {
    if (isDiacritic(word[prevCharIndex])) {
      prevDiacritics.push(word[prevCharIndex]);
      prevCharIndex--;
    } else if (isIgnoredChar(word[prevCharIndex])) {
      prevCharIndex--; // تخطي الرموز المخفية والعودة للخلف
    } else {
      break;
    }
  }
  const prevChar = prevCharIndex >= 0 ? word[prevCharIndex] : null;

  // د. إذا كان الحرف السابق عليه ألف خنجرية، والحرف الحالي عارٍ تماماً من التشكيل -> ألف مقصورة
  if (prevDiacritics.includes(DIACRITICS.DAGGER_ALIF)) {
    return 'ى';
  }

  // هـ. إذا كان مسبوقاً بألف مد مرسومة (ا) -> ياء
  if (prevChar === 'ا') {
    return 'ي';
  }

  // و. إذا كان الحرف السابق مكسوراً أو عليه سكون -> ياء (مثل: فِي، وَحْي)
  if (prevDiacritics.includes(DIACRITICS.KASRA) || prevDiacritics.includes(DIACRITICS.SUKUN)) {
    return 'ي';
  }

  // الحالة الافتراضية للرسم العثماني
  return 'ى'; 
}