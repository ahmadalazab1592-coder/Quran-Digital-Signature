import { db } from '../db/database';
import { cleanQuranText, isDiacritic, classifyYaaOrMaqsura, isArabicLetter, isIgnoredChar } from './textProcessor';

const nonConnectingLeftChars = ['ا', 'أ', 'إ', 'آ', 'ٱ', 'د', 'ذ', 'ر', 'ز', 'و', 'ؤ', 'ة', 'ء'];

const isSafeArabicLetter = (char) => isArabicLetter(char) || ['ٱ', 'ا', 'أ', 'إ', 'آ', 'ء', 'ؤ', 'ئ', 'ة', 'ي', 'ى', '\u0654', '\u0655'].includes(char);

function getPrevBareLetter(word, index) {
  for (let k = index - 1; k >= 0; k--) {
    const char = word[k];
    if (char === '\u0654' || char === '\u0655' || char === '\u0640' || isDiacritic(char) || isIgnoredChar(char)) continue;
    if (isSafeArabicLetter(char)) {
      if (['أ', 'إ', 'آ', 'ٱ'].includes(char)) return 'ا';
      if (char === 'ؤ') return 'و';
      if (char === 'ئ') return 'ي'; 
      if (char === 'ء') return 'ء';
      if (char === 'ة') return 'ة';
      if (char === 'ي' || char === 'ى') return 'ي';
      return char;
    }
  }
  return null;
}

export async function scanWholeQuran(quranData, setProgress) {
  const manualOverrides = await db.manual_overrides.toArray();
  const overridesMap = {};
  manualOverrides.forEach(o => overridesMap[o.shape] = { newBareLetter: o.newBareLetter, newShape: o.newShape });
  
  const exclusionsDb = await db.exclusions.toArray();
  
  const letterStats = {}; 
  const discoveryOrder = []; 
  const surahStatsMap = {}; 
  
  let spatialCounter = 0;

  setProgress('المسح الأول: جاري الإحصاء الموازي للعائلات، والهيئات، والاتصال...');

  for (const surah of quranData) {
    for (const ayah of surah.ayahs) {
      const cleanedText = cleanQuranText(ayah.text);
      const words = cleanedText.split(/\s+/).filter(w => w.trim());

      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const word = words[wIdx];
        
        let i = 0;
        while (i < word.length) {
          let char = word[i];

          if (!isSafeArabicLetter(char) && char !== '\u0640') { i++; continue; }

          const isExcluded = exclusionsDb.some(ex => {
            if (ex.type === 'word_global') return ex.wordText === word && ex.charIdx === i;
            if (ex.type === 'instance') return ex.surah === surah.id && ex.ayah === ayah.number && ex.wordIdx === wIdx && ex.charIdx === i;
            return false;
          });

          if (char === '\u0654' || char === '\u0655') {
            char = 'ء';
          }

          let j = i + 1;
          let diacritics = ''; 
          while (j < word.length) {
            let nextChar = word[j];
            
            if (nextChar === '\u0640' && (word[j+1] === '\u0654' || word[j+1] === '\u0655')) {
              break; 
            }
            
            if (nextChar === '\u0654' || nextChar === '\u0655') {
              let isChair = ['ا', 'و', 'ى', 'ي', 'ئ', '\u0640'].includes(char);
              let hasVowelBeforeHamza = /[\u064E\u064F\u0650\u0651\u0652]/.test(diacritics);
              if (!isChair || hasVowelBeforeHamza) {
                break;
              }
            }

            if (isDiacritic(nextChar) || nextChar === '\u0640' || isIgnoredChar(nextChar)) {
              if (isDiacritic(nextChar)) diacritics += nextChar; 
              j++;
            } else {
              break;
            }
          }

          let isSpecialHamza = false;
          let isHamzaBelow = false;

          if (char === '\u0640' && (diacritics.includes('\u0654') || diacritics.includes('\u0655'))) {
            isHamzaBelow = diacritics.includes('\u0655');
            char = 'ء';
            diacritics = diacritics.replace('\u0654', '').replace('\u0655', '');
            isSpecialHamza = true;
          } else if (char === '\u0640') {
            i = j; continue; 
          }

          if (['ء', 'أ', 'إ', 'آ'].includes(char)) {
            let prevB = getPrevBareLetter(word, i);
            let nextB = null;
            let tempCharIndex = j;
            for (let k = tempCharIndex; k < word.length; k++) {
              let nk = word[k];
              if (nk === '\u0654' || nk === '\u0655' || nk === '\u0640' || isDiacritic(nk) || isIgnoredChar(nk)) continue;
              if (isSafeArabicLetter(nk)) {
                let c = nk;
                if (['أ', 'إ', 'آ', 'ٱ', 'ا'].includes(c)) nextB = 'ا';
                else nextB = c;
                break;
              }
            }
            if (prevB === 'ل' && (nextB === 'ا' || diacritics.includes('\u0653') || char === 'آ')) {
              if (char === 'إ' || diacritics.includes('\u0650')) isHamzaBelow = true;
              char = 'ء';
              isSpecialHamza = true;
            } 
            else if (char === 'ء' && !isSpecialHamza && prevB && !nonConnectingLeftChars.includes(prevB) && nextB !== null) {
              isSpecialHamza = true;
              if (diacritics.includes('\u0650')) isHamzaBelow = true;
            }
          }

          let isFloatingHamza = false;
          if (char === 'ء') {
            let hasBefore = false;
            for (let prevIdx = 0; prevIdx < i; prevIdx++) {
              if (isSafeArabicLetter(word[prevIdx])) { hasBefore = true; break; }
            }
            let hasAfter = false;
            for (let nextIdx = j; nextIdx < word.length; nextIdx++) {
              if (isSafeArabicLetter(word[nextIdx])) { hasAfter = true; break; }
            }
            if (hasBefore && hasAfter) isFloatingHamza = true; 
          }

          let bareLetter = char;
          let shapeBase = char; 

          if (char === 'ة') bareLetter = 'ت';
          else if (['أ', 'إ', 'آ', 'ء', 'ؤ', 'ٱ', 'ئ'].includes(char)) {
            bareLetter = 'ا';
            shapeBase = char; 
          } else if (char === 'ى') {
            let hasSmallAlif = false;
            let hasPrimaryDiacritic = false; 
            let tempJ = i + 1;
            while (tempJ < word.length && (isDiacritic(word[tempJ]) || word[tempJ] === '\u0640' || isIgnoredChar(word[tempJ]))) {
              if (word[tempJ] === '\u0670') hasSmallAlif = true;
              if (['\u064E', '\u064F', '\u0650', '\u0651', '\u0652'].includes(word[tempJ])) hasPrimaryDiacritic = true;
              tempJ++;
            }
            if (hasSmallAlif && !hasPrimaryDiacritic) {
              bareLetter = 'ا'; 
            } else {
              const type = classifyYaaOrMaqsura(word, i, char);
              bareLetter = type === 'ي' ? 'ي' : 'ا';
            }
            shapeBase = char; 
          } else if (char === 'ي') {
            bareLetter = 'ي';
            shapeBase = char;
          }

          if (isExcluded) { i = j; continue; }

          spatialCounter++; 

          let connectRight = false;
          let connectLeft = false;

          if (char !== 'ء') {
            const prevBare = getPrevBareLetter(word, i);
            if (prevBare && !nonConnectingLeftChars.includes(prevBare)) connectRight = true; 

            let hasNextLetter = false;
            let nextAcceptsRightConnection = false;

            for (let k = j; k < word.length; k++) {
              let nk = word[k];
              if (nk === 'ء') {
                hasNextLetter = true;
                nextAcceptsRightConnection = false;
                break;
              }
              if (nk === '\u0640') {
                let checkNext = k + 1;
                let hasHamza = false;
                while (checkNext < word.length && (isDiacritic(word[checkNext]) || isIgnoredChar(word[checkNext]))) {
                    if (word[checkNext] === '\u0654' || word[checkNext] === '\u0655') hasHamza = true;
                    checkNext++;
                }
                if (hasHamza) {
                    hasNextLetter = true;
                    nextAcceptsRightConnection = false;
                    break;
                } else {
                    continue; 
                }
              }
              if (nk === '\u0654' || nk === '\u0655' || isDiacritic(nk) || isIgnoredChar(nk)) continue;

              if (isSafeArabicLetter(nk)) {
                hasNextLetter = true;
                nextAcceptsRightConnection = true;
                break;
              }
            }

            let currentCharForConnection = char;
            if (char === 'ؤ') currentCharForConnection = 'و';
            if (['أ', 'إ', 'آ', 'ٱ'].includes(char)) currentCharForConnection = 'ا';

            if (hasNextLetter && nextAcceptsRightConnection && !nonConnectingLeftChars.includes(currentCharForConnection)) {
               connectLeft = true; 
            }
          }

// 🟢 القاعدة الهندسية الصارمة: 4 حالات فيزيائية فقط للاتصال
          let connectionName = 'منفصل';
          if (isSpecialHamza) {
            connectionName = 'وسطي'; // لأنها تُرسم على خط تطويل متصل فيزيائياً
          } else if (char === 'ء') {
            connectionName = 'منفصل'; // الهمزة العائمة مستقلة فيزيائياً
          } else {
            if (connectRight && connectLeft) connectionName = 'وسطي';
            else if (connectRight && !connectLeft) connectionName = 'متطرف';
            else if (!connectRight && connectLeft) connectionName = 'مبتدئ';
          }

          let actualShape = shapeBase + diacritics;
          if (isSpecialHamza) {
            shapeBase = isHamzaBelow ? 'ـٕـ' : 'ـٔـ';
            actualShape = shapeBase + diacritics;
          } else if (char === 'ى' && connectLeft) {
            actualShape = shapeBase + '\u0640' + diacritics; 
          }

          if (overridesMap[actualShape]) {
            if (overridesMap[actualShape].newBareLetter) bareLetter = overridesMap[actualShape].newBareLetter;
            if (overridesMap[actualShape].newShape) actualShape = overridesMap[actualShape].newShape;
          }

          let positionalForm = shapeBase + diacritics;
          if (char !== 'ء' && !isSpecialHamza) {
            if (connectRight) positionalForm = '\u0640' + positionalForm;
            if (connectLeft) positionalForm = positionalForm + '\u0640';
          }

          if (!letterStats[bareLetter]) {
            letterStats[bareLetter] = { total: 0, exactShapesCounts: {}, connectionsCounts: {}, instances: {} };
          }
          
          letterStats[bareLetter].total++;
          
          if (!letterStats[bareLetter].exactShapesCounts[actualShape]) letterStats[bareLetter].exactShapesCounts[actualShape] = 0;
          letterStats[bareLetter].exactShapesCounts[actualShape]++;
          
          if (!letterStats[bareLetter].connectionsCounts[connectionName]) letterStats[bareLetter].connectionsCounts[connectionName] = 0;
          letterStats[bareLetter].connectionsCounts[connectionName]++;

          const instanceKey = `${actualShape}_${connectionName}`;
          if (!letterStats[bareLetter].instances[instanceKey]) {
            const newInstance = {
              count: 0,
              firstSpatialPosition: spatialCounter,
              firstSurah: surah.id,
              actualForms: new Set(),
              shapeBase: shapeBase,
              diacritics: diacritics,
              actualShape: actualShape, 
              bareLetter: bareLetter,
              connectionName: connectionName,
              instanceKey: instanceKey
            };
            letterStats[bareLetter].instances[instanceKey] = newInstance;
            discoveryOrder.push(newInstance); 
          }
          
          letterStats[bareLetter].instances[instanceKey].count++;
          letterStats[bareLetter].instances[instanceKey].actualForms.add(positionalForm);

          const ssKey = `${surah.id}_${bareLetter}_${actualShape}_${connectionName}`;
          if (!surahStatsMap[ssKey]) surahStatsMap[ssKey] = { surahNumber: surah.id, bareLetter, actualShape: actualShape, connectionName, count: 0 };
          surahStatsMap[ssKey].count++;

          i = j;
        }
      }
    }
  }

  setProgress('المسح الثاني: جاري ترتيب الهوية الذاتية للحروف وتوليد البصمات...');

  const finalFingerprints = [];
  
  const sortedFamilies = Object.keys(letterStats).sort((a, b) => letterStats[b].total - letterStats[a].total);
  const rankMaps = {}; 
  
  sortedFamilies.forEach((f, fIdx) => {
    const familyRank = (fIdx + 1).toString().padStart(2, '0');
    rankMaps[f] = { familyRank, exactShapes: {}, connections: {} };
    
    const esCounts = letterStats[f].exactShapesCounts;
    const sortedExactShapes = Object.keys(esCounts).sort((a, b) => esCounts[b] - esCounts[a]);
    sortedExactShapes.forEach((es, esIdx) => {
      rankMaps[f].exactShapes[es] = (esIdx + 1).toString().padStart(2, '0');
    });

    const cCounts = letterStats[f].connectionsCounts;
    const sortedConnections = Object.keys(cCounts).sort((a, b) => cCounts[b] - cCounts[a]);
    sortedConnections.forEach((c, cIdx) => {
      // 🟢 تقليص خانة الاتصال إلى خانة واحدة بدون صفر على اليسار
      rankMaps[f].connections[c] = (cIdx + 1).toString();
    });
    
    Object.values(letterStats[f].instances).forEach(instance => {
      const esRank = rankMaps[f].exactShapes[instance.actualShape];
      const cRank = rankMaps[f].connections[instance.connectionName];
      instance.compositeId = `${familyRank}-${esRank}-${cRank}`;
    });
  });

  discoveryOrder.forEach((node, idx) => {
    finalFingerprints.push({
      compositeId: node.compositeId, 
      chronologicalId: idx + 1,      
      firstSpatialPosition: node.firstSpatialPosition, 
      totalCount: node.count,        
      bareLetter: node.bareLetter,
      diacritics: node.diacritics,   
      connectionState: node.connectionName,
      shape: node.actualShape,
      firstSurah: node.firstSurah,
      actualForms: Array.from(node.actualForms)
    });
  });

  const surahStatsArray = Object.values(surahStatsMap).map(ss => {
    const instance = letterStats[ss.bareLetter].instances[`${ss.actualShape}_${ss.connectionName}`];
    return {
      surahNumber: ss.surahNumber,
      compositeId: instance.compositeId,
      bareLetter: ss.bareLetter,
      count: ss.count
    };
  });

  setProgress('جاري حفظ البصمات في قاعدة البيانات...');

  await db.transaction('rw', db.global_fingerprints, db.surah_stats, async () => {
    await db.global_fingerprints.clear();
    await db.surah_stats.clear();
    await db.global_fingerprints.bulkAdd(finalFingerprints);
    await db.surah_stats.bulkAdd(surahStatsArray);
  });

  return { success: true };
}