import Dexie from 'dexie';

export const db = new Dexie('QuranStatsDB');

// تم رفع الإصدار إلى 4 وبناء هيكل شجري متقدم يخدم البصمة الرقمية
db.version(4).stores({
  // جدول البصمة الرقمية الشامل (يحل محل الجداول القديمة المشتتة)
  // compositeId: المعرف المركب الدقيق (عائلة + اتصال + تشكيل)
  // chronologicalId: رقم الاكتشاف التسلسلي (لترتيب الظهور العام)
 global_fingerprints: 'compositeId, chronologicalId, bareLetter, diacritics, connectionState, shape, firstSpatialPosition, totalCount, firstSurah',
  
  // جدول إحصائيات السور مبني على المعرف المركب الجديد
  surah_stats: '++id, surahNumber, compositeId, bareLetter, count',
  
  // جدول الاستبعادات الدقيقة (كما هو ليحافظ على خياراتك السابقة)
  exclusions: '++id, type, surah, ayah, wordIdx, charIdx, wordText, shape',
  
  // التعديلات اليدوية لنقل العائلات
  manual_overrides: 'shape, newBareLetter'
});