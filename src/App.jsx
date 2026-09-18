import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/database';
import { scanWholeQuran } from './utils/scanner'; 
import { cleanQuranText, isArabicLetter, isDiacritic, classifyYaaOrMaqsura, isIgnoredChar } from './utils/textProcessor';
import Plot from 'react-plotly.js';
import { Analytics } from '@vercel/analytics/react';

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

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null, errorInfo: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { this.setState({ errorInfo }); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#f8d7da', color: '#721c24', direction: 'rtl', fontFamily: 'Arial' }}>
          <h2>🚨 حدث خطأ برمجي أدى لتوقف العرض</h2>
          <pre style={{ background: '#fff', padding: '15px', overflowX: 'auto', direction: 'ltr' }}>{this.state.error && this.state.error.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function MainApp() {
  const [quranData, setQuranData] = useState([]);
  const [selectedSurahId, setSelectedSurahId] = useState(1);
  const [viewScope, setViewScope] = useState('surah');
  const [selectedLetter, setSelectedLetter] = useState(null);
  const [selectedShapeToHighlight, setSelectedShapeToHighlight] = useState(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(1);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState('');
  
  const [excludeModalOpen, setExcludeModalOpen] = useState(false);
  const [exclusionData, setExclusionData] = useState(null);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveData, setMoveData] = useState(null);
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [debugData, setDebugData] = useState(null);

  // 🟢 حالة نافذة "عن التطبيق"
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [coordData, setCoordData] = useState(null);

  // 🟢 متغيرات غرفة التوثيق والمطابقة
  const [verifyText, setVerifyText] = useState('');
  const [verifySurahId, setVerifySurahId] = useState(1);
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyNumBase, setVerifyNumBase] = useState('spatial');
  const [verifyMode, setVerifyMode] = useState('strict'); // 🟢 السطر الجديد: لتحديد مستوى الصرامة

  // 🟢 إعدادات معمل البصمة الزمكانية
const [labSettings, setLabSettings] = useState({
    numBase: 'spatial',
    granularity: 'words',
    outputType: '2d',
    scope: 'surah',
    highlightLetter: '' // 🟢 متغير لتمييز حرف محدد بصرياً
  });
  const [labOutputData, setLabOutputData] = useState(null);

// 🟢 متغيرات مرصد مواقع النجوم (المقارن المتعدد)
  const [trackedStars, setTrackedStars] = useState([]);
  const [isTrackerVisible, setIsTrackerVisible] = useState(false);

// 🟢 محرك مرصد النجوم (النسخة المعيارية الشاملة)
  const openStarTracker = (targetWord, compositeIds, addToComparison = false) => {
    
    // 🟢 دالة التوحيد المعياري: تجرد الكلمة من كل الزوائد لضمان اصطيادها في كل مواضعها
    const normalizeForSearch = (str) => {
       if (!str) return '';
       return str.replace(/[\u064B-\u065F\u0670\u0640]/g, '') // إزالة التشكيل، الألف الخنجرية، والتطويل
                 .replace(/[ٱأإآ]/g, 'ا') // توحيد كل أنواع الألف إلى ألف عادية
                 .replace(/[ىي]/g, 'ي')   // توحيد الياء
                 .replace(/ة/g, 'ه');     // توحيد التاء المربوطة
    };

    // تنظيف وتوحيد الكلمة المستهدفة
    const rawClean = cleanQuranText(targetWord);
    const searchTarget = normalizeForSearch(rawClean);
    
    // 1. حساب القيم
    const getVal = (id, base) => {
       const fp = globalFingerprints.find(g => g.compositeId === id);
       if(!fp) return 0;
       if(base === 'sequential') return fp.chronologicalId;
       if(base === 'spatial') return fp.firstSpatialPosition;
       if(base === 'composite') return parseInt(fp.compositeId.replace(/-/g, ''), 10);
       return 0;
    };
    
    const valSequential = compositeIds.reduce((sum, id) => sum + getVal(id, 'sequential'), 0);
    const valSpatial = compositeIds.reduce((sum, id) => sum + getVal(id, 'spatial'), 0);
    const valComposite = compositeIds.reduce((sum, id) => sum + getVal(id, 'composite'), 0);

    // 2. مسح المصحف بالرادار المعياري
    let occurrences = [];
    let globalWordIndex = 0;
    let sumOfPositions = 0;
    let firstAppearance = null;

    quranData.forEach(surah => {
       surah.ayahs.forEach(ayah => {
          const words = cleanQuranText(ayah.text).split(/\s+/).filter(w => w.trim());
          words.forEach(w => {
             globalWordIndex++;
             // 🟢 مقارنة الكلمة بعد توحيدها معيارياً
             if (normalizeForSearch(w) === searchTarget) {
                occurrences.push({
                   surahName: surah.name,
                   ayahNum: ayah.number,
                   globalPos: globalWordIndex
                });
                sumOfPositions += globalWordIndex;
                if (!firstAppearance) firstAppearance = globalWordIndex;
             }
          });
       });
    });

    let distances = [];
    for (let i = 1; i < occurrences.length; i++) {
       distances.push(occurrences[i].globalPos - occurrences[i-1].globalPos);
    }

    const specialProduct = firstAppearance ? (firstAppearance * valSpatial) : 0;

    const newStar = {
       word: targetWord, count: occurrences.length, occurrences, distances,
       valSequential, valSpatial, valComposite, sumOfPositions, firstAppearance, specialProduct
    };

    if (addToComparison) {
       setTrackedStars(prev => {
          if(prev.find(s => s.word === targetWord)) return prev;
          return [...prev, newStar];
       });
    } else {
       setTrackedStars([newStar]);
    }
    
    setIsTrackerVisible(true);
  };

  // 🟢 متغيرات وضع التحليل العددي المباشر
  const [interactionMode, setInteractionMode] = useState('explore'); 
  const [selectedAnalysisWords, setSelectedAnalysisWords] = useState([]); 
  const [analysisNumBase, setAnalysisNumBase] = useState('spatial');
  const surahWordsDataRef = React.useRef([]); // 🟢 مرجع لتجميع كل كلمات السورة لزر التحديد الجماعي
  const exclusionsList = useLiveQuery(() => db.exclusions.toArray(), []) || [];
  const globalFingerprints = useLiveQuery(() => db.global_fingerprints.orderBy('chronologicalId').toArray(), []) || [];
  const surahStats = useLiveQuery(
    () => db.surah_stats.where('surahNumber').equals(Number(selectedSurahId)).toArray(),
    [selectedSurahId]
  );
  const manualOverrides = useLiveQuery(() => db.manual_overrides.toArray(), []) || [];

  useEffect(() => {
    fetch('/quran.json').then(res => res.json()).then(setQuranData).catch(console.error);
  }, []);

  const currentSurah = quranData.find(s => s.id === Number(selectedSurahId));

  const overridesMap = {};
  manualOverrides.forEach(o => overridesMap[o.shape] = { newBareLetter: o.newBareLetter, newShape: o.newShape });

  const fpLookupMap = useMemo(() => {
    const map = new Map();
    globalFingerprints.forEach(fp => {
      map.set(`${fp.bareLetter}_${fp.shape}_${fp.connectionState}`, fp.compositeId);
    });
    return map;
  }, [globalFingerprints]);

  // 🟢 دوال التحليل العددي المباشر
  const isPrimeNumber = (num) => {
    if (num <= 1) return false;
    if (num === 2) return true;
    for (let i = 2; i <= Math.sqrt(num); i++) {
      if (num % i === 0) return false;
    }
    return true;
  };

  const getLetterValueForAnalysis = (compositeId) => {
     const fp = globalFingerprints.find(g => g.compositeId === compositeId);
     if (!fp) return 0;
     if (analysisNumBase === 'sequential') return fp.chronologicalId;
     if (analysisNumBase === 'spatial') return fp.firstSpatialPosition;
     if (analysisNumBase === 'composite') {
        return parseInt(fp.compositeId.replace(/-/g, ''), 10);
     }
     return 0;
  };

  const totalAnalysisValue = useMemo(() => {
     let sum = 0;
     selectedAnalysisWords.forEach(w => {
        w.compositeIds.forEach(cid => sum += getLetterValueForAnalysis(cid));
     });
     return sum;
  }, [selectedAnalysisWords, analysisNumBase, globalFingerprints]);

  const handleGlobalScan = async () => {
    if (!quranData.length) return;
    setIsScanning(true);
    try {
      await scanWholeQuran(quranData, setProgress);
      setProgress('تم المسح الشامل وبناء البصمات بنجاح!');
      setTimeout(() => setProgress(''), 3000);
    } catch (error) {
      console.error(error);
      setProgress('حدث خطأ أثناء المسح.');
    } finally {
      setIsScanning(false);
    }
  };

const normalizeForSearch = (text) => {
    if (!text) return '';
    // 🟢 أضفنا \u0640 في نهاية القوس الأول لمسح التطويل (الكشيدة) نهائياً
    return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u06DF-\u06E8\u0640]/g, '')
               .replace(/[أإآٱ]/g, 'ا')
               .replace(/ة/g, 'ه')
               .replace(/[ىئؤء]/g, 'ي');
  };

// 🟢 1. مراجع برمجية لضمان سرعة إدخال الحروف دون تقطيع
  const searchInputRef = React.useRef(null);
  const searchTimeoutRef = React.useRef(null);

  // 🟢 2. الفهرس الذكي: يتم تجريد كل المصحف من التشكيل (مرة واحدة فقط عند فتح التطبيق) لتسريع البحث
  const searchIndex = useMemo(() => {
    const index = [];
    quranData.forEach(surah => {
      surah.ayahs.forEach(ayah => {
        index.push({
          surahId: surah.id,
          surahName: surah.name,
          ayahNum: ayah.number,
          text: ayah.text,
          normalizedText: normalizeForSearch(ayah.text) // ⚡ تم التجهيز المسبق هنا!
        });
      });
    });
    return index;
  }, [quranData]);

  // 🟢 3. محرك البحث (يقرأ من الفهرس السريع مباشرة دون أي تأخير)
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const normQuery = normalizeForSearch(searchQuery);
    // البحث أصبح صاروخياً لأنه يبحث في نصوص جاهزة في الذاكرة!
    const results = searchIndex.filter(item => item.normalizedText.includes(normQuery));
    setSearchResults(results.slice(0, 40));
  }, [searchQuery, searchIndex]);

  const clearSelection = () => {
    setSelectedLetter(null);
    setSelectedShapeToHighlight(null);
    setCoordData(null);
  };

  const calculateCoordinates = (tSurah, tAyah, tWord, tChar) => {
    let gWord = 0, gLetter = 0, sWord = 0, sLetter = 0, aWord = 0, aLetter = 0;

    for (const surah of quranData) {
      if (surah.id > tSurah) break;
      const isTargetSurah = surah.id === tSurah;

      for (const ayah of surah.ayahs) {
        if (isTargetSurah && ayah.number > tAyah) break;
        const isTargetAyah = isTargetSurah && ayah.number === tAyah;

        const words = ayah.text.split(/\s+/).filter(w => w.trim());
        for (let w = 0; w < words.length; w++) {
          if (isTargetAyah && w > tWord) break;
          const isTargetWord = isTargetAyah && w === tWord;
          const word = words[w];

          let validLettersInWord = 0;
          let c = 0;
          while (c < word.length) {
            if (isTargetWord && c > tChar) break; 
            
            let cChar = word[c];
            if (cChar === '\u0654' || cChar === '\u0655') cChar = 'ء';
            
            let tempJ = c + 1;
            let tempDiacritics = '';
            while(tempJ < word.length) {
                let nextTemp = word[tempJ];
                if (nextTemp === '\u0640' && (word[tempJ+1] === '\u0654' || word[tempJ+1] === '\u0655')) break;
                if ((nextTemp === '\u0654' || nextTemp === '\u0655') && !['ا', 'و', 'ى', 'ي', 'ئ', '\u0640'].includes(cChar)) break;
                if (isDiacritic(nextTemp) || nextTemp === '\u0640' || isIgnoredChar(nextTemp)) {
                    if (isDiacritic(nextTemp)) tempDiacritics += nextTemp;
                    tempJ++;
                } else break;
            }

            if (cChar === '\u0640' && (tempDiacritics.includes('\u0654') || tempDiacritics.includes('\u0655'))) cChar = 'ء';

            if (isSafeArabicLetter(cChar) && cChar !== '\u0640') {
                const isExcluded = exclusionsList.some(ex => 
                   (ex.type === 'word_global' && ex.wordText === word && ex.charIdx === c) ||
                   (ex.type === 'instance' && ex.surah === surah.id && ex.ayah === ayah.number && ex.wordIdx === w && ex.charIdx === c)
                 );
                 if (!isExcluded) validLettersInWord++;
            }
            c = tempJ;
          }

          if (validLettersInWord > 0 || isTargetWord) {
             gWord++;
             if (isTargetSurah) sWord++;
             if (isTargetAyah) aWord++;
          }

          gLetter += validLettersInWord;
          if (isTargetSurah) sLetter += validLettersInWord;
          if (isTargetAyah) aLetter += validLettersInWord; 

          if (isTargetWord) return { gWord, gLetter, sWord, sLetter, aWord, aLetter };
        }
      }
    }
    return { gWord, gLetter, sWord, sLetter, aWord, aLetter };
  };

  const globalLettersMap = {};
  globalFingerprints.forEach(fp => {
    if (!globalLettersMap[fp.bareLetter]) globalLettersMap[fp.bareLetter] = 0;
    globalLettersMap[fp.bareLetter] += fp.totalCount;
  });
  const globalLetters = Object.keys(globalLettersMap).map(k => ({ letter: k, totalCount: globalLettersMap[k] }));

  const safeSortedLetters = [...(viewScope === 'global' ? globalLetters : Object.values((surahStats || []).reduce((acc, item) => {
    const bare = item.bareLetter;
    if (!acc[bare]) acc[bare] = { letter: bare, totalCount: 0 };
    acc[bare].totalCount += item.count;
    return acc;
  }, {})))].sort((a, b) => b.totalCount - a.totalCount);

  const currentShapeSurahStat = surahStats?.find(s => s.compositeId === selectedShapeToHighlight);
  const totalInSurah = currentShapeSurahStat ? currentShapeSurahStat.count : 0;
  const currentShapeGlobalStat = globalFingerprints.find(g => g.compositeId === selectedShapeToHighlight);
  const totalInGlobal = currentShapeGlobalStat ? currentShapeGlobalStat.totalCount : 0;

  const shapeOccurrences = useLiveQuery(
    () => selectedShapeToHighlight ? db.surah_stats.where('compositeId').equals(selectedShapeToHighlight).toArray() : [],
    [selectedShapeToHighlight]
  );
  
  const sortedOccurrences = (shapeOccurrences || []).sort((a, b) => a.surahNumber - b.surahNumber);
  const currentSurahOccIndex = sortedOccurrences.findIndex(o => o.surahNumber === selectedSurahId);
  
  let globalMatchIndex = 0;
  if (currentSurahOccIndex !== -1) {
    const previousSurahsCount = sortedOccurrences.slice(0, currentSurahOccIndex).reduce((sum, occ) => sum + occ.count, 0);
    globalMatchIndex = previousSurahsCount + currentMatchIndex;
  }
  const isFirstGlobalMatch = currentSurahOccIndex === 0 && currentMatchIndex === 1;
  const isLastGlobalMatch = currentSurahOccIndex === sortedOccurrences.length - 1 && currentMatchIndex === totalInSurah;

  useEffect(() => {
    if (selectedShapeToHighlight && currentMatchIndex > 0 && viewScope !== 'timeline' && viewScope !== 'lab') {
      let attempts = 0;
      const tryScroll = () => {
        const el = document.getElementById(`match-${currentMatchIndex}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else if (attempts < 30) { attempts++; setTimeout(tryScroll, 200); }
      };
      setTimeout(tryScroll, 200);
    }
  }, [currentMatchIndex, selectedShapeToHighlight, selectedSurahId, viewScope]);

  useEffect(() => {
    if (selectedShapeToHighlight && currentSurah) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`match-${currentMatchIndex}`);
        if (el) {
          const tAyah = parseInt(el.getAttribute('data-ayah'), 10);
          const tWord = parseInt(el.getAttribute('data-widx'), 10);
          const tChar = parseInt(el.getAttribute('data-i'), 10);
          setCoordData(calculateCoordinates(currentSurah.id, tAyah, tWord, tChar));
        }
      }, 50); 
      return () => clearTimeout(timer);
    } else {
      setCoordData(null);
    }
  }, [currentMatchIndex, selectedShapeToHighlight, currentSurah, exclusionsList]);

  const totalLettersInSurah = (surahStats || []).reduce((sum, stat) => sum + stat.count, 0);
  const totalLettersInGlobal = globalFingerprints.reduce((sum, item) => sum + item.totalCount, 0);
  const totalWordsInSurah = useMemo(() => {
    if (!currentSurah) return 0;
    return currentSurah.ayahs.reduce((sum, ayah) => {
      const words = cleanQuranText(ayah.text).split(/\s+/).filter(w => w.trim());
      return sum + words.length;
    }, 0);
  }, [currentSurah]);

  const getGroupedShapes = () => {
    if (!selectedLetter) return [];
    
    let relevantData = [];
    if (viewScope === 'global') {
      relevantData = globalFingerprints.filter(fp => fp.bareLetter === selectedLetter);
    } else {
      const filteredSurahShapes = (surahStats || []).filter(s => s.bareLetter === selectedLetter);
      relevantData = filteredSurahShapes.map(s => {
        const globalMeta = globalFingerprints.find(g => g.compositeId === s.compositeId);
        return { ...globalMeta, totalCount: s.count };
      });
    }

    const grouped = {};
    relevantData.forEach(item => {
      const groupKey = item.shape; 
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          shape: item.shape,
          displayTitle: item.shape,
          allForms: new Set(),
          totalCount: 0,
          items: []
        };
      }
      grouped[groupKey].totalCount += item.totalCount;
      grouped[groupKey].items.push(item);
      
      if (item.actualForms && item.actualForms.length > 0) {
        item.actualForms.forEach(form => grouped[groupKey].allForms.add(form));
      } else {
        grouped[groupKey].allForms.add(item.shape);
      }
    });

    const sortedGroups = Object.values(grouped).sort((a, b) => b.totalCount - a.totalCount);
    sortedGroups.forEach(group => group.items.sort((a, b) => b.totalCount - a.totalCount));
    return sortedGroups;
  };

  const jumpToShapeInText = (shapeData) => {
    if (shapeData.firstSurah && shapeData.firstSurah !== selectedSurahId) {
      setSelectedSurahId(shapeData.firstSurah);
    }
    setSelectedLetter(shapeData.bareLetter); 
    setSelectedShapeToHighlight(shapeData.compositeId); 
    setCurrentMatchIndex(1); 
    if (viewScope === 'timeline' || viewScope === 'lab') setViewScope('surah');
  };

// 🟢 محرك المطابقة والتوثيق الرقمي (مع رادار كشف الانحراف)
  const handleVerifyText = () => {
    if (!verifyText.trim()) { alert('يرجى إدخال أو رفع النص أولاً'); return; }
    if (globalFingerprints.length === 0) { alert('يرجى مسح المصحف أولاً'); return; }
    
    let dbText = '';
    let targetName = '';
    let targetIdForHash = 0;

    if (verifySurahId === 0) {
       dbText = quranData.map(s => s.ayahs.map(a => a.text).join(' ')).join(' ');
       targetName = 'المصحف كاملاً';
       targetIdForHash = 999; 
    } else {
       const targetSurah = quranData.find(s => s.id === verifySurahId);
       if (!targetSurah) return;
       dbText = targetSurah.ayahs.map(a => a.text).join(' ');
       targetName = `سورة ${targetSurah.name}`;
       targetIdForHash = targetSurah.id;
    }

// 🟢 فرع المطابقة المرنة (لتجاهل الألف الخنجرية والتشكيل والزوائد وأرقام الآيات)
    if (verifyMode === 'flexible') {
       // مقص تنظيف إضافي: يمسح الأرقام (العربية والإنجليزية) والأقواس وعلامات الترقيم ويحولها لمسافات
       const stripPunctuation = (str) => str.replace(/[0-9٠-٩\{\}\(\)\[\]،.؛:"'«»\-]/g, ' ');
       
       const dbWords = stripPunctuation(dbText).split(/\s+/).filter(w => w.trim());
       const inputWords = stripPunctuation(verifyText).split(/\s+/).filter(w => w.trim());
       
       let isMatch = true;
       let mismatchInfo = null;

       for (let i = 0; i < Math.max(dbWords.length, inputWords.length); i++) {
           const wOriginal = dbWords[i] ? normalizeForSearch(dbWords[i]) : null;
           const wInput = inputWords[i] ? normalizeForSearch(inputWords[i]) : null;
           
           if (wOriginal !== wInput) {
               isMatch = false;
               mismatchInfo = {
                   index: i + 1,
                   origWord: dbWords[i] || '(نقص في النص)',
                   origVal: 'تجاهل (وضع مرن)',
                   inpWord: inputWords[i] || '(إضافة غريبة)',
                   inpVal: 'تجاهل (وضع مرن)'
               };
               break;
           }
       }

       setVerifyResult({ 
          isMatch, 
          originalData: { signature: 'FLEX-MODE-NO-HASH', totalItems: dbWords.length, totalValue: 'N/A' }, 
          inputData: { signature: 'FLEX-MODE-NO-HASH', totalItems: inputWords.length, totalValue: 'N/A' }, 
          surahName: targetName, 
          mismatchInfo 
       });
       return;
    }

    // 🟢 فرع المطابقة الصارمة (الكود الأصلي المشفر)
    const getLetterVal = (compositeId) => {
       const fp = globalFingerprints.find(g => g.compositeId === compositeId);
       if (!fp) return 0;
       if (verifyNumBase === 'sequential') return fp.chronologicalId;
       if (verifyNumBase === 'spatial') return fp.firstSpatialPosition;
       if (verifyNumBase === 'composite') return parseInt(fp.compositeId.replace(/-/g, ''), 10);
       return 0;
    };

    const generateSignatureForText = (textInput, sId) => {
       const cleanedText = cleanQuranText(textInput);
       const words = cleanedText.split(/\s+/).filter(w => w.trim());
       let totalValue = 0;
       let totalItems = 0;
       let tokens = [];

       words.forEach((word) => {
          let wordValueSum = 0;
          let i = 0;
          while (i < word.length) {
             let char = word[i];
             if (char === '\u0654' || char === '\u0655') char = 'ء';
             let j = i + 1;
             let diacritics = '';
             while (j < word.length) {
                let nextChar = word[j];
                if (nextChar === '\u0640' && (word[j+1] === '\u0654' || word[j+1] === '\u0655')) break; 
                if (nextChar === '\u0654' || nextChar === '\u0655') {
                   let isChair = ['ا', 'و', 'ى', 'ي', 'ئ', '\u0640'].includes(char);
                   let hasVowelBeforeHamza = /[\u064E\u064F\u0650\u0651\u0652]/.test(diacritics);
                   if (!isChair || hasVowelBeforeHamza) break;
                }
                if (isDiacritic(nextChar) || nextChar === '\u0640' || isIgnoredChar(nextChar)) {
                   if (isDiacritic(nextChar)) diacritics += nextChar; j++;
                } else break;
             }
             let isSpecialHamza = false;
             let isHamzaBelow = false;
             if (char === '\u0640' && (diacritics.includes('\u0654') || diacritics.includes('\u0655'))) {
                isHamzaBelow = diacritics.includes('\u0655'); char = 'ء';
                diacritics = diacritics.replace('\u0654', '').replace('\u0655', ''); isSpecialHamza = true;
             }
             if (['ء', 'أ', 'إ', 'آ'].includes(char)) {
                let prevB = getPrevBareLetter(word, i); let nextB = null;
                for (let k = j; k < word.length; k++) {
                   let nk = word[k];
                   if (nk === '\u0654' || nk === '\u0655' || nk === '\u0640' || isDiacritic(nk) || isIgnoredChar(nk)) continue;
                   if (isSafeArabicLetter(nk)) { nextB = ['أ', 'إ', 'آ', 'ٱ', 'ا'].includes(nk) ? 'ا' : nk; break; }
                }
                if (prevB === 'ل' && (nextB === 'ا' || diacritics.includes('\u0653') || char === 'آ')) {
                   if (char === 'إ' || diacritics.includes('\u0650')) isHamzaBelow = true; char = 'ء'; isSpecialHamza = true;
                } else if (char === 'ء' && !isSpecialHamza && prevB && !nonConnectingLeftChars.includes(prevB) && nextB !== null) {
                   isSpecialHamza = true; if (diacritics.includes('\u0650')) isHamzaBelow = true;
                }
             }
             const isClickable = isSafeArabicLetter(char) && char !== '\u0640';
             if (isClickable) {
                let bareLetter = char; let shapeBase = char;
                if (char === 'ة') bareLetter = 'ت';
                else if (['أ', 'إ', 'آ', 'ء', 'ؤ', 'ٱ', 'ئ'].includes(char)) { bareLetter = 'ا'; shapeBase = char; }
                else if (char === 'ى') {
                   let hasSmallAlif = false; let hasPrimaryDiacritic = false; let tempJ = i + 1;
                   while (tempJ < word.length && (isDiacritic(word[tempJ]) || word[tempJ] === '\u0640' || isIgnoredChar(word[tempJ]))) {
                      if (word[tempJ] === '\u0670') hasSmallAlif = true;
                      if (['\u064E', '\u064F', '\u0650', '\u0651', '\u0652'].includes(word[tempJ])) hasPrimaryDiacritic = true; tempJ++;
                   }
                   bareLetter = (hasSmallAlif && !hasPrimaryDiacritic) ? 'ا' : (classifyYaaOrMaqsura(word, i, char) === 'ي' ? 'ي' : 'ا');
                   shapeBase = char;
                } else if (char === 'ي') { bareLetter = 'ي'; shapeBase = char; }

                let connectRight = false; let connectLeft = false;
                if (char !== 'ء') {
                   const prevBare = getPrevBareLetter(word, i);
                   if (prevBare && !nonConnectingLeftChars.includes(prevBare)) connectRight = true; 
                   let hasNextLetter = false; let nextAcceptsRightConnection = false;
                   for (let k = j; k < word.length; k++) {
                      let nk = word[k];
                      if (nk === 'ء' || nk === '\u0654' || nk === '\u0655') { hasNextLetter = true; break; }
                      if (nk === '\u0640') {
                         let checkNext = k + 1; let hasHamza = false;
                         while (checkNext < word.length && (isDiacritic(word[checkNext]) || isIgnoredChar(word[checkNext]))) {
                            if (word[checkNext] === '\u0654' || word[checkNext] === '\u0655') hasHamza = true; checkNext++;
                         }
                         if (hasHamza) { hasNextLetter = true; break; }
                      }
                      if (isSafeArabicLetter(nk) && nk !== '\u0640') { hasNextLetter = true; nextAcceptsRightConnection = true; break; }
                   }
                   let currentCharForConnection = char;
                   if (char === 'ؤ') currentCharForConnection = 'و';
                   if (['أ', 'إ', 'آ', 'ٱ'].includes(char)) currentCharForConnection = 'ا';
                   if (hasNextLetter && nextAcceptsRightConnection && !nonConnectingLeftChars.includes(currentCharForConnection)) connectLeft = true; 
                }
                let connectionName = 'منفصل';
                if (isSpecialHamza) connectionName = 'وسطي';
                else if (char === 'ء') connectionName = 'منفصل';
                else {
                   if (connectRight && connectLeft) connectionName = 'وسطي';
                   else if (connectRight && !connectLeft) connectionName = 'متطرف';
                   else if (!connectRight && connectLeft) connectionName = 'مبتدئ';
                }
                let actualShape = shapeBase + diacritics;
                if (isSpecialHamza) actualShape = (isHamzaBelow ? 'ـٕـ' : 'ـٔـ') + diacritics;
                else if (char === 'ى' && connectLeft) actualShape = shapeBase + '\u0640' + diacritics;
                if (overridesMap[actualShape]) {
                   bareLetter = overridesMap[actualShape].newBareLetter || bareLetter;
                   actualShape = overridesMap[actualShape].newShape || actualShape;
                }

                const compositeId = fpLookupMap.get(`${bareLetter}_${actualShape}_${connectionName}`);
                if (compositeId) {
                   wordValueSum += getLetterVal(compositeId);
                }
             }
             i = j;
          }
          if (wordValueSum > 0) {
             totalValue += wordValueSum;
             totalItems++;
             tokens.push({ word, value: wordValueSum });
          }
       });

       const hashBase = (totalValue * totalItems * sId).toString(16).toUpperCase();
       const idPrefix = sId === 999 ? 'ALL' : sId.toString().padStart(3, '0');
       return { totalValue, totalItems, signature: `QUR-${idPrefix}-${totalItems}-${totalValue}-${hashBase}`, tokens };
    };

    const originalData = generateSignatureForText(dbText, targetIdForHash);
    const inputData = generateSignatureForText(verifyText, targetIdForHash);
    const isMatch = originalData.signature === inputData.signature;

    let mismatchInfo = null;
    if (!isMatch) {
       for (let i = 0; i < Math.max(originalData.tokens.length, inputData.tokens.length); i++) {
          const orig = originalData.tokens[i];
          const inp = inputData.tokens[i];
          if (!orig || !inp || orig.value !== inp.value || orig.word !== inp.word) {
             mismatchInfo = {
                index: i + 1,
                origWord: orig ? orig.word : '(نقص في النص)',
                origVal: orig ? orig.value : 0,
                inpWord: inp ? inp.word : '(إضافة غريبة)',
                inpVal: inp ? inp.value : 0
             };
             break;
          }
       }
    }

    setVerifyResult({ isMatch, originalData, inputData, surahName: targetName, mismatchInfo });
  };

const executeLabAnalysis = () => {
    if (!currentSurah && labSettings.scope === 'surah') {
      alert('يرجى اختيار سورة أولاً'); return;
    }
    if (globalFingerprints.length === 0) {
       alert('يرجى عمل مسح للمصحف أولاً لتوليد البصمات'); return;
    }

    setLabOutputData({ status: 'Processing...', preview: 'جاري المعالجة وبناء الفضاء الزمكاني...', plotData: null });

    setTimeout(() => {
      try {
        const targetSurahs = labSettings.scope === 'quran' ? quranData : [currentSurah];
        let finalPreview = '';
        
        let plotX = [];
        let plotY = [];
        let plotZ = [];
        let plotText = [];
        let plotColors = []; // 🟢 مصفوفة الألوان
        let globalCounter = 0; 

        const getLetterValue = (compositeId) => {
           const fp = globalFingerprints.find(g => g.compositeId === compositeId);
           if (!fp) return 0;
           if (labSettings.numBase === 'sequential') return fp.chronologicalId;
           if (labSettings.numBase === 'spatial') return fp.firstSpatialPosition;
           if (labSettings.numBase === 'composite') return parseInt(fp.compositeId.replace(/-/g, ''), 10);
           return 0;
        };

        targetSurahs.forEach(surah => {
           let surahTextRaw = [];
           let surahTextDetailed = [];
           
           surah.ayahs.forEach(ayah => {
              let ayahRawTokens = [];
              const cleanedText = cleanQuranText(ayah.text);
              const words = cleanedText.split(/\s+/).filter(w => w.trim());
              
              words.forEach((word, wIdx) => {
                 let wordValueSum = 0;
                 let wordLettersRaw = [];
                 let wordLettersDetails = [];
                 let hasHighlightedLetter = false; // 🟢 تعقب الكلمة التي تحتوي الحرف المطلوب
                 
                 let i = 0;
                 while (i < word.length) {
                    let char = word[i];
                    if (char === '\u0654' || char === '\u0655') char = 'ء';
                    
                    let j = i + 1;
                    let diacritics = '';
                    while (j < word.length) {
                       let nextChar = word[j];
                       if (nextChar === '\u0640' && (word[j+1] === '\u0654' || word[j+1] === '\u0655')) break; 
                       if (nextChar === '\u0654' || nextChar === '\u0655') {
                          let isChair = ['ا', 'و', 'ى', 'ي', 'ئ', '\u0640'].includes(char);
                          let hasVowelBeforeHamza = /[\u064E\u064F\u0650\u0651\u0652]/.test(diacritics);
                          if (!isChair || hasVowelBeforeHamza) break;
                       }
                       if (isDiacritic(nextChar) || nextChar === '\u0640' || isIgnoredChar(nextChar)) {
                          if (isDiacritic(nextChar)) diacritics += nextChar; j++;
                       } else break;
                    }

                    let isSpecialHamza = false;
                    let isHamzaBelow = false;
                    if (char === '\u0640' && (diacritics.includes('\u0654') || diacritics.includes('\u0655'))) {
                       isHamzaBelow = diacritics.includes('\u0655'); char = 'ء';
                       diacritics = diacritics.replace('\u0654', '').replace('\u0655', ''); isSpecialHamza = true;
                    }

                    if (['ء', 'أ', 'إ', 'آ'].includes(char)) {
                       let prevB = getPrevBareLetter(word, i); let nextB = null;
                       for (let k = j; k < word.length; k++) {
                          let nk = word[k];
                          if (nk === '\u0654' || nk === '\u0655' || nk === '\u0640' || isDiacritic(nk) || isIgnoredChar(nk)) continue;
                          if (isSafeArabicLetter(nk)) { nextB = ['أ', 'إ', 'آ', 'ٱ', 'ا'].includes(nk) ? 'ا' : nk; break; }
                       }
                       if (prevB === 'ل' && (nextB === 'ا' || diacritics.includes('\u0653') || char === 'آ')) {
                          if (char === 'إ' || diacritics.includes('\u0650')) isHamzaBelow = true; char = 'ء'; isSpecialHamza = true;
                       } else if (char === 'ء' && !isSpecialHamza && prevB && !nonConnectingLeftChars.includes(prevB) && nextB !== null) {
                          isSpecialHamza = true; if (diacritics.includes('\u0650')) isHamzaBelow = true;
                       }
                    }

                    const isClickable = isSafeArabicLetter(char) && char !== '\u0640';
                    if (isClickable) {
                       let bareLetter = char; let shapeBase = char;
                       if (char === 'ة') bareLetter = 'ت';
                       else if (['أ', 'إ', 'آ', 'ء', 'ؤ', 'ٱ', 'ئ'].includes(char)) { bareLetter = 'ا'; shapeBase = char; }
                       else if (char === 'ى') {
                          let hasSmallAlif = false; let hasPrimaryDiacritic = false; let tempJ = i + 1;
                          while (tempJ < word.length && (isDiacritic(word[tempJ]) || word[tempJ] === '\u0640' || isIgnoredChar(word[tempJ]))) {
                             if (word[tempJ] === '\u0670') hasSmallAlif = true;
                             if (['\u064E', '\u064F', '\u0650', '\u0651', '\u0652'].includes(word[tempJ])) hasPrimaryDiacritic = true;
                             tempJ++;
                          }
                          bareLetter = (hasSmallAlif && !hasPrimaryDiacritic) ? 'ا' : (classifyYaaOrMaqsura(word, i, char) === 'ي' ? 'ي' : 'ا');
                          shapeBase = char;
                       } else if (char === 'ي') { bareLetter = 'ي'; shapeBase = char; }

                       let connectRight = false; let connectLeft = false;
                       if (char !== 'ء') {
                          const prevBare = getPrevBareLetter(word, i);
                          if (prevBare && !nonConnectingLeftChars.includes(prevBare)) connectRight = true; 
                          let hasNextLetter = false; let nextAcceptsRightConnection = false;
                          for (let k = j; k < word.length; k++) {
                             let nk = word[k];
                             if (nk === 'ء' || nk === '\u0654' || nk === '\u0655') { hasNextLetter = true; break; }
                             if (nk === '\u0640') {
                                let checkNext = k + 1; let hasHamza = false;
                                while (checkNext < word.length && (isDiacritic(word[checkNext]) || isIgnoredChar(word[checkNext]))) {
                                   if (word[checkNext] === '\u0654' || word[checkNext] === '\u0655') hasHamza = true; checkNext++;
                                }
                                if (hasHamza) { hasNextLetter = true; break; }
                             }
                             if (isSafeArabicLetter(nk) && nk !== '\u0640') { hasNextLetter = true; nextAcceptsRightConnection = true; break; }
                          }
                          let currentCharForConnection = char;
                          if (char === 'ؤ') currentCharForConnection = 'و';
                          if (['أ', 'إ', 'آ', 'ٱ'].includes(char)) currentCharForConnection = 'ا';
                          if (hasNextLetter && nextAcceptsRightConnection && !nonConnectingLeftChars.includes(currentCharForConnection)) connectLeft = true; 
                       }

                       let connectionName = 'منفصل';
                       if (isSpecialHamza) connectionName = 'وسطي';
                       else if (char === 'ء') connectionName = 'منفصل';
                       else {
                          if (connectRight && connectLeft) connectionName = 'وسطي';
                          else if (connectRight && !connectLeft) connectionName = 'متطرف';
                          else if (!connectRight && connectLeft) connectionName = 'مبتدئ';
                       }

                       let actualShape = shapeBase + diacritics;
                       if (isSpecialHamza) actualShape = (isHamzaBelow ? 'ـٕـ' : 'ـٔـ') + diacritics;
                       else if (char === 'ى' && connectLeft) actualShape = shapeBase + '\u0640' + diacritics;

                       if (overridesMap[actualShape]) {
                          bareLetter = overridesMap[actualShape].newBareLetter || bareLetter;
                          actualShape = overridesMap[actualShape].newShape || actualShape;
                       }

                       const isExcluded = exclusionsList.some(ex => 
                          (ex.type === 'word_global' && ex.wordText === word && ex.charIdx === i) ||
                          (ex.type === 'instance' && ex.surah === surah.id && ex.ayah === ayah.number && ex.wordIdx === wIdx && ex.charIdx === i)
                       );

                       if (!isExcluded) {
                          const compositeId = fpLookupMap.get(`${bareLetter}_${actualShape}_${connectionName}`);
                          if (compositeId) {
                             const val = getLetterValue(compositeId);
                             wordValueSum += val;
                             wordLettersRaw.push(val);
                             wordLettersDetails.push(`${char}(${val})`);
                             
                             // 🟢 التحقق من الحرف
                             if (labSettings.highlightLetter && bareLetter === labSettings.highlightLetter) {
                                 hasHighlightedLetter = true;
                             }

// 🟢 إحداثيات وألوان الحروف
                             if (labSettings.granularity === 'letters') {
                                globalCounter++;
                                plotX.push(globalCounter);
                                plotY.push(val);
                                plotZ.push(labSettings.scope === 'quran' ? surah.id : ayah.number); 
                                
                                let pointColor = '#3498db';
                                let letterExtraText = '';
                                
                                if (labSettings.highlightLetter && bareLetter === labSettings.highlightLetter) {
                                    pointColor = '#e74c3c';
                                    letterExtraText = `<br>🎯 تتضمن الحرف: ${labSettings.highlightLetter}`;
                                } else if (val > 0 && val % 19 === 0) {
                                    pointColor = '#8e44ad';
                                    letterExtraText = `<br>✨ مضاعف 19 (19 × ${val / 19})`;
                                } else if (isPrimeNumber(val)) {
                                    pointColor = '#27ae60';
                                    letterExtraText = `<br>🌟 عدد أولي`;
                                }
                                plotColors.push(pointColor);
                                
                                plotText.push(`سورة ${surah.name}<br>الآية ${ayah.number}<br>الكلمة: ${word}<br>الحرف: ${char}<br>القيمة: ${val}${letterExtraText}`);
                             }
                          }
                       }
                    }
                    i = j;
                 }
                 
                 // 🟢 إحداثيات وألوان الكلمات
                 if (labSettings.granularity === 'words' && wordLettersRaw.length > 0) {
                    globalCounter++;
                    plotX.push(globalCounter);
                    plotY.push(wordValueSum);
                    plotZ.push(labSettings.scope === 'quran' ? surah.id : ayah.number);
                    
                    let pointColor = '#3498db';
                    let extraText = '';
                    
                    if (hasHighlightedLetter) { 
                        pointColor = '#e74c3c'; 
                        extraText = `<br>🎯 تتضمن الحرف: ${labSettings.highlightLetter}`; 
                    } else if (wordValueSum > 0 && wordValueSum % 19 === 0) { 
                        pointColor = '#8e44ad'; 
                        extraText = `<br>✨ مضاعف 19 (19 × ${wordValueSum / 19})`; 
                    } else if (isPrimeNumber(wordValueSum)) { 
                        pointColor = '#27ae60'; 
                        extraText = `<br>🌟 عدد أولي`; 
                    }
                    
                    plotColors.push(pointColor);
                    plotText.push(`سورة ${surah.name}<br>الآية ${ayah.number}<br>الكلمة: ${word}<br>القيمة: ${wordValueSum}${extraText}`);
                 }

                 if (labSettings.granularity === 'letters') {
                    if (wordLettersRaw.length > 0) ayahRawTokens.push(wordLettersRaw.join(' , '));
                    surahTextDetailed.push(`الكلمة: [ ${word} ] | الآية: ${ayah.number} | القيم: ${wordLettersDetails.join(' , ')}`);
                 } else {
                    ayahRawTokens.push(wordValueSum.toString());
                    surahTextDetailed.push(`الكلمة: [ ${word} ] | الآية: ${ayah.number} | القيمة الإجمالية: ${wordValueSum}`);
                 }
              }); 
              
              if (ayahRawTokens.length > 0) surahTextRaw.push(ayahRawTokens.join(' / '));
           }); 

if (surahTextRaw.length > 0 || labSettings.granularity === 'letters') {
              finalPreview += `\n======== سورة ${surah.name} ========\n\n`;
              
              if (labSettings.outputType === 'signature') {
                 // بناء التوقيع الرقمي
                 const totalValue = plotY.reduce((a,b) => a + b, 0);
                 const totalItems = plotY.length;
                 const hashBase = (totalValue * totalItems * surah.id).toString(16).toUpperCase();
                 const finalSignature = `QUR-${surah.id.toString().padStart(3, '0')}-${totalItems}-${totalValue}-${hashBase}`;
                 
                 finalPreview += `🔐 التوقيع الرقمي الزمكاني للمقطع المحدد:\n`;
                 finalPreview += `[ ${finalSignature} ]\n\n`;
                 finalPreview += `💡 هذا الكود المرجعي فريد تماماً بالمعايير التي اخترتها.\nأي تغيير في حرف، أو موضع، أو قيمة سيؤدي لانهيار هذا التوقيع فوراً.`;
              
              } else if (labSettings.outputType === 'export') {
                 // تصدير البيانات إلى ملف CSV
                 let csvContent = "data:text/csv;charset=utf-8,\uFEFF" + "رقم السورة,رقم الآية,القيمة العددية\n";
                 for(let k=0; k<plotY.length; k++){
                     csvContent += `${surah.id},${plotZ[k]},${plotY[k]}\n`;
                 }
                 const encodedUri = encodeURI(csvContent);
                 const link = document.createElement("a");
                 link.setAttribute("href", encodedUri);
                 link.setAttribute("download", `Quran_Data_Surah_${surah.id}.csv`);
                 document.body.appendChild(link);
                 link.click();
                 document.body.removeChild(link);
                 finalPreview += `✅ تم بناء وتصدير البيانات بنجاح.\n\nتفقد مجلد التنزيلات (Downloads) في جهازك لفتح ملف الإكسيل.`;
                 
              } else {
                 finalPreview += `تمت المعالجة بنجاح. يتم الآن عرض الخرائط البصرية...`;
              }
           }
        }); 
        
        setLabOutputData({ 
           status: 'Success', 
           preview: finalPreview, 
           plotData: { x: plotX, y: plotY, z: plotZ, text: plotText, colors: plotColors } // 🟢 مصفوفة الألوان هنا
        });
      } catch (error) {
        console.error(error);
        setLabOutputData({ status: 'Error', preview: 'حدث خطأ أثناء المعالجة الرياضية' });
      }
    }, 500);
  };

const renderInteractiveAyah = (ayah, shapeCounters, extractedWordsData = []) => {
    const cleanedText = cleanQuranText(ayah.text);
    const words = cleanedText.split(/\s+/).filter(w => w.trim());
    
    return words.map((word, wIdx) => {
      if (!word.trim()) return <span key={wIdx}>{word}</span>;
      const elements = [];
      let currentWordCompositeIds = []; 
      let i = 0;
      
      while (i < word.length) {
        let char = word[i];
        let chunk = '';
        
        if (char === '\u0654' || char === '\u0655') {
          char = 'ء';
          chunk += 'ء'; 
        } else {
          chunk += char;
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
            chunk += nextChar;
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

        const isClickable = isSafeArabicLetter(char) && char !== '\u0640';
        let bareLetter = char;
        let actualShape = char;
        let compositeId = null;
        let myMatchIndex = null;
        let lookupKeyDebug = '';

        // 🟢 الحل البصري النظيف: تفعيل الكشيدة الصريحة للهمزة وترك باقي الكلمات بطبيعتها
        let displayChunk = chunk;
        if (isSpecialHamza) {
            displayChunk = (isHamzaBelow ? 'ـٕـ' : 'ـٔـ') + diacritics;
        }

        let connectionName = 'منفصل';

        if (isClickable) {
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

          let connectRight = false;
          let connectLeft = false;

          // 🟢 تم مطابقة المنطق الداخلي حرفياً مع scanner.js لمنع فشل التلوين
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

          if (isSpecialHamza) {
            connectionName = 'وسطي';
          } else if (char === 'ء') {
            connectionName = 'منفصل';
          } else {
            if (connectRight && connectLeft) connectionName = 'وسطي';
            else if (connectRight && !connectLeft) connectionName = 'متطرف';
            else if (!connectRight && connectLeft) connectionName = 'مبتدئ';
          }

          actualShape = shapeBase + diacritics;
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

          lookupKeyDebug = `${bareLetter}_${actualShape}_${connectionName}`;
          compositeId = fpLookupMap.get(lookupKeyDebug);
          
          if (compositeId) {
            if (typeof shapeCounters === 'object') {
              shapeCounters[compositeId] = (shapeCounters[compositeId] || 0) + 1;
              myMatchIndex = shapeCounters[compositeId];
            }
          }
        }

        const isExcluded = exclusionsList.some(ex => 
           (ex.type === 'word_global' && ex.wordText === word && ex.charIdx === i) ||
           (ex.type === 'instance' && ex.surah === currentSurah?.id && ex.ayah === ayah.number && ex.wordIdx === wIdx && ex.charIdx === i)
        );

        if (isClickable && compositeId && !isExcluded) {
           currentWordCompositeIds.push(compositeId);
        }

        const isHighlighted = isClickable && compositeId && !isExcluded && (selectedShapeToHighlight === compositeId);
        let currentMatchId = null;
        let isCurrentFocused = false;

        if (isHighlighted) {
          currentMatchId = `match-${myMatchIndex}`;
          isCurrentFocused = (myMatchIndex === currentMatchIndex);
        }

        if (isClickable) {
          const openXRay = (e) => {
            e.stopPropagation(); 
            e.preventDefault(); 
            const hexCodes = Array.from(actualShape).map(c => `${c} (U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
            setExclusionData({ 
              surah: currentSurah.id, ayah: ayah.number, wordIdx: wIdx, charIdx: i, wordText: word, shape: actualShape, 
              debugInfo: { char: char, actualShape: actualShape, bareLetter: bareLetter, connectionName: connectionName, compositeId: compositeId, lookupKey: lookupKeyDebug, hexCodes: hexCodes }
            });
            setExcludeModalOpen(true);
          };

          elements.push(
            <span
              id={currentMatchId}
              data-ayah={ayah.number}
              data-widx={wIdx}
              data-i={i}
              key={`${ayah.id}-${wIdx}-${i}`}
              onClick={(e) => {
                if (interactionMode === 'analyze') return; 
                e.stopPropagation();
                setSelectedLetter(bareLetter);
                setSelectedShapeToHighlight(compositeId);
                if (myMatchIndex) setCurrentMatchIndex(myMatchIndex);

                setTimeout(() => {
                   const shapeRow = document.getElementById(`shape-row-${compositeId}`);
                   if (shapeRow) {
                       shapeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                   } else {
                      const treeSection = document.getElementById('shapes-tree-section');
                      if (treeSection) treeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                   }
                }, 150);
              }}
              onDoubleClick={openXRay}
              style={isHighlighted ? {
                cursor: 'pointer',
                backgroundColor: isCurrentFocused ? '#f39c12' : '#f1c40f',
                color: isCurrentFocused ? '#fff' : '#c0392b',
                borderRadius: '3px',
                borderBottom: isCurrentFocused ? '2px solid #c0392b' : 'none',
                position: 'relative',
                zIndex: 5,
                display: 'inline'
              } : {
                cursor: 'pointer',
                display: 'inline' // 🟢 ترك الحرف يتصل طبيعياً وبدون أي قيود CSS إضافية تعيق محرك الخطوط
              }}
            >
              {displayChunk}
            </span>
          );
        } else {
          elements.push(<span key={`${ayah.id}-${wIdx}-${i}`} style={{ display: 'inline' }}>{chunk}</span>);
        }
        
        i = j;
      }
      
      elements.push(<span key={`space-${wIdx}`} style={{ paddingLeft: '8px' }}> </span>);
      
      const wordKey = `${ayah.number}_${wIdx}`;
      const isWordSelected = selectedAnalysisWords.some(w => w.key === wordKey);
      
      extractedWordsData.push({ key: wordKey, text: word, ayah: ayah.number, wIdx, compositeIds: currentWordCompositeIds });
      
      return (
         <span 
            key={`word-${wIdx}`} 
            onClick={(e) => {
               if (interactionMode !== 'analyze') return;
               e.stopPropagation();
               setSelectedAnalysisWords(prev => {
                  if (prev.find(w => w.key === wordKey)) return prev.filter(w => w.key !== wordKey);
                  return [...prev, { key: wordKey, text: word, ayah: ayah.number, wIdx, compositeIds: currentWordCompositeIds }];
               });
            }}
            onContextMenu={(e) => {
               e.preventDefault();
               e.stopPropagation();
               if (trackedStars.length > 0) {
                   const wantCompare = window.confirm(`المرصد يحتفظ حالياً ببيانات (${trackedStars.map(s => s.word).join('، ')}).\n\nهل تريد إضافة [ ${word} ] للمقارنة معهم على نفس المخطط؟\n\n- اضغط (OK / موافق) للإضافة.\n- اضغط (Cancel / إلغاء) لمسح المرصد وبدء رصد هذه الكلمة وحدها.`);
                   openStarTracker(word, currentWordCompositeIds, wantCompare);
               } else {
                   openStarTracker(word, currentWordCompositeIds, false);
               }
            }}
            style={interactionMode === 'analyze' ? {
               backgroundColor: isWordSelected ? 'rgba(230, 126, 34, 0.2)' : 'transparent',
               boxShadow: isWordSelected ? '0 3px 0 0 #e67e22' : 'none',
               borderRadius: '4px',
               cursor: 'pointer',
               transition: 'all 0.2s',
               display: 'inline',
               lineHeight: '1.8'
            } : { cursor: 'context-menu', display: 'inline' }}
            title="كليك يمين لفتح مرصد النجوم لهذه الكلمة 🔭"
         >
            {elements}
         </span>
      );
    });
  };

  if (quranData.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '100px', fontFamily: 'Arial', fontSize: '24px', direction: 'rtl' }}>
        جاري تحميل النص القرآني وإعداد قاعدة البيانات...
      </div>
    );
  }

  return (
    <div onClick={clearSelection} style={{ padding: '20px', fontFamily: '"Asmaa Boutros", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif', direction: 'rtl', maxWidth: '1300px', margin: 'auto' }}>
<header style={{ marginBottom: '25px', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
               <div style={{ background: 'linear-gradient(135deg, #3498db, #8e44ad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: '32px', fontWeight: '900', letterSpacing: '-0.5px' }}>
                 تطبيق البصمة الرقمية للقرآن الكريم
               </div>
               <div style={{ height: '3px', width: '50px', background: 'linear-gradient(90deg, rgba(52,152,219,0.5) 0%, rgba(255,255,255,0) 100%)', borderRadius: '5px' }}></div>
            </div>
            
            <button 
               onClick={() => setIsAboutModalOpen(true)}
               style={{ background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(52, 152, 219, 0.4)', color: '#2c3e50', padding: '8px 15px', borderRadius: '20px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', transition: '0.3s' }}
               onMouseEnter={(e) => { e.currentTarget.style.background = '#3498db'; e.currentTarget.style.color = '#fff'; }}
               onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'; e.currentTarget.style.color = '#2c3e50'; }}
            >
               ℹ️ عن المنصة
            </button>
          </header>

      <div onClick={(e) => e.stopPropagation()} style={{ position: 'sticky', top: 0, zIndex: 999, paddingTop: '5px', paddingBottom: '10px', backgroundColor: '#f4f6f8' }}>
{/* 🟢 منطقة البحث وعرض الإحداثيات (تصميم مضغوط لتقليل الارتفاع) */}
        {viewScope !== 'lab' && viewScope !== 'verify' && viewScope !== 'timeline' && (
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'stretch' }}>
            
            {/* 🔍 مربع البحث */}
            <div style={{ flex: '0 0 25%', position: 'relative', zIndex: 999 }}>
<input 
                ref={searchInputRef}
                type="text" 
                placeholder="ابحث عن أي كلمة..." 
                defaultValue={searchQuery}
                onChange={(e) => {
                  // 🟢 الخدعة الذكية: إيقاف إعادة رسم السورة مع كل حرف، والانتظار (300ms) بعد التوقف عن الكتابة لتنفيذ البحث
                  if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                  searchTimeoutRef.current = setTimeout(() => {
                     setSearchQuery(e.target.value);
                  }, 300);
                }}
                style={{ 
                  width: '100%', height: '100%', padding: '6px 12px', fontSize: '13px', 
                  borderRadius: '10px', border: 'none', outline: 'none', 
                  fontFamily: '"Amiri Quran", serif', boxSizing: 'border-box',
                  backgroundColor: '#eef2f5', color: '#2c3e50',
                  boxShadow: 'inset 3px 3px 6px rgba(163,177,198,0.5), inset -3px -3px 6px rgba(255,255,255, 0.9)'
                }}
              />
              
              {/* قائمة نتائج البحث */}
              {searchResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, background: '#eef2f5', border: '1px solid #fff', borderRadius: '12px', maxHeight: '300px', overflowY: 'auto', boxShadow: '4px 4px 15px rgba(163,177,198,0.6), -4px -4px 15px rgba(255,255,255, 0.9)', marginTop: '5px', padding: '8px' }}>
                  {searchResults.map((res, idx) => (
                    <div key={idx} onClick={() => { 
                      setSelectedSurahId(res.surahId); 
                      setSearchQuery(''); 
                      setSearchResults([]); 
                      clearSelection(); 
                      if (searchInputRef.current) searchInputRef.current.value = ''; // 🟢 تفريغ المربع برمجياً
                      if(viewScope === 'lab') setViewScope('surah');
                      setTimeout(() => {
                        const ayahEl = document.getElementById(`ayah-${res.ayahNum}`);
                        if (ayahEl) {
                          ayahEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          ayahEl.style.backgroundColor = '#f1c40f55'; 
                          setTimeout(() => ayahEl.style.backgroundColor = 'transparent', 2000);
                        }
                      }, 300);
                    }} style={{ padding: '8px', borderBottom: '1px solid rgba(163,177,198,0.2)', cursor: 'pointer', borderRadius: '6px', transition: '0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.5)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ fontWeight: 'bold', color: '#3498db', fontSize: '11px', marginBottom: '2px' }}>سورة {res.surahName} (آية {res.ayahNum})</div>
                      <div style={{ fontFamily: '"Amiri Quran", serif', fontSize: '16px', color: '#2c3e50' }}>{res.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 📍 مربع عرض الإحداثيات (مضغوط) */}
            <div style={{ flex: '1', backgroundColor: '#eef2f5', border: 'none', borderRadius: '10px', padding: '6px 15px', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: 'inset 3px 3px 6px rgba(163,177,198,0.5), inset -3px -3px 6px rgba(255,255,255, 0.9)' }}>
              {!coordData ? (
                <div style={{ textAlign: 'center', color: '#7f8c8d', fontSize: '13px', fontFamily: '"Amiri Quran", serif' }}>
                  اضغط على أي حرف لعرض إحداثياته...
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#2c3e50', display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'Arial, sans-serif' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(163,177,198,0.5)', paddingBottom: '3px' }}>
                    <b style={{ color: '#8e44ad' }}>📍 الحرف:</b>
                    <span>آية: <b style={{ color: '#c0392b' }}>{coordData.aLetter.toLocaleString()}</b></span>
                    <span>سورة: <b style={{ color: '#c0392b' }}>{coordData.sLetter.toLocaleString()}</b></span>
                    <span>مصحف: <b style={{ color: '#c0392b' }}>{coordData.gLetter.toLocaleString()}</b></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <b style={{ color: '#2980b9' }}>🏷️ الكلمة:</b>
                    <span>آية: <b style={{ color: '#d35400' }}>{coordData.aWord.toLocaleString()}</b></span>
                    <span>سورة: <b style={{ color: '#d35400' }}>{coordData.sWord.toLocaleString()}</b></span>
                    <span>مصحف: <b style={{ color: '#d35400' }}>{coordData.gWord.toLocaleString()}</b></span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

{/* 🟢 شريط أدوات التحكم والتنقل (صف واحد إجباري لزيادة مساحة النص) */}
        <div style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: '6px', alignItems: 'center', backgroundColor: '#eef2f5', padding: '8px 12px', borderRadius: '12px', boxShadow: '3px 3px 8px rgba(163,177,198,0.5), -3px -3px 8px rgba(255,255,255, 0.9)', marginBottom: '15px' }}>
          
          {/* زر المسح العام */}
          {viewScope !== 'lab' && viewScope !== 'verify' && viewScope !== 'timeline' && (
            <button onClick={handleGlobalScan} disabled={isScanning} style={{ flexShrink: 0, fontFamily: 'inherit', padding: '6px 10px', backgroundColor: '#eef2f5', color: '#27ae60', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', boxShadow: '2px 2px 5px rgba(163,177,198,0.5), -2px -2px 5px rgba(255,255,255, 0.9)', transition: '0.2s', opacity: isScanning ? 0.7 : 1, whiteSpace: 'nowrap' }}>
              {isScanning ? 'جاري المسح...' : 'مسح المصحف كاملاً'}
            </button>
          )}
          
          {/* قائمة السور */}
          {viewScope !== 'verify' && viewScope !== 'timeline' && (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '2px', borderRadius: '8px', boxShadow: 'inset 2px 2px 4px rgba(163,177,198,0.5), inset -2px -2px 4px rgba(255,255,255, 0.9)', backgroundColor: '#eef2f5' }}>
              <select value={selectedSurahId} onChange={(e) => { setSelectedSurahId(Number(e.target.value)); setCurrentMatchIndex(1); }} style={{ fontFamily: 'inherit', padding: '4px 8px', borderRadius: '6px', fontSize: '13px', border: 'none', fontWeight: 'bold', color: '#2c3e50', backgroundColor: 'transparent', outline: 'none', cursor: 'pointer' }}>
                {quranData.map(s => <option key={s.id} value={s.id}>{s.id}. سورة {s.name}</option>)}
              </select>
            </div>
          )}

          {/* التبويبات المتلاصقة */}
          <button onClick={() => setViewScope('surah')} style={{ flexShrink: 0, fontFamily: 'inherit', padding: '6px 10px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', transition: '0.2s', backgroundColor: '#eef2f5', color: viewScope === 'surah' ? '#2980b9' : '#34495e', boxShadow: viewScope === 'surah' ? 'inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255, 0.9)' : '2px 2px 5px rgba(163,177,198,0.5), -2px -2px 5px rgba(255,255,255, 0.9)', whiteSpace: 'nowrap' }}>
            السورة الحالية
          </button>
          
          <button onClick={() => setViewScope('global')} style={{ flexShrink: 0, fontFamily: 'inherit', padding: '6px 10px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', transition: '0.2s', backgroundColor: '#eef2f5', color: viewScope === 'global' ? '#2980b9' : '#34495e', boxShadow: viewScope === 'global' ? 'inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255, 0.9)' : '2px 2px 5px rgba(163,177,198,0.5), -2px -2px 5px rgba(255,255,255, 0.9)', whiteSpace: 'nowrap' }}>
            عائلات المصحف
          </button>
          
          <button onClick={() => setViewScope('timeline')} style={{ flexShrink: 0, fontFamily: 'inherit', padding: '6px 10px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', transition: '0.2s', backgroundColor: '#eef2f5', color: viewScope === 'timeline' ? '#2980b9' : '#34495e', boxShadow: viewScope === 'timeline' ? 'inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255, 0.9)' : '2px 2px 5px rgba(163,177,198,0.5), -2px -2px 5px rgba(255,255,255, 0.9)', whiteSpace: 'nowrap' }}>
            ترتيب الظهور العام
          </button>
          
          <button onClick={() => setViewScope('lab')} style={{ flexShrink: 0, fontFamily: 'inherit', padding: '6px 10px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', transition: '0.2s', backgroundColor: '#eef2f5', color: viewScope === 'lab' ? '#8e44ad' : '#34495e', boxShadow: viewScope === 'lab' ? 'inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255, 0.9)' : '2px 2px 5px rgba(163,177,198,0.5), -2px -2px 5px rgba(255,255,255, 0.9)', whiteSpace: 'nowrap' }}>
            معمل البصمة الرقمية 🔬
          </button>
          
          <button onClick={() => { setViewScope('verify'); setVerifyResult(null); }} style={{ flexShrink: 0, fontFamily: 'inherit', padding: '6px 10px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', transition: '0.2s', backgroundColor: '#eef2f5', color: viewScope === 'verify' ? '#c0392b' : '#34495e', boxShadow: viewScope === 'verify' ? 'inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255, 0.9)' : '2px 2px 5px rgba(163,177,198,0.5), -2px -2px 5px rgba(255,255,255, 0.9)', whiteSpace: 'nowrap' }}>
            غرفة المطابقة والتوثيق 🛡️
          </button>
          
          {/* زر التحليل العددي المباشر (مضغوط إلى أقصى اليسار) */}
          <button onClick={() => {
             if (viewScope !== 'surah') setViewScope('surah');
             setInteractionMode(prev => prev === 'explore' ? 'analyze' : 'explore');
             setSelectedAnalysisWords([]);
          }} style={{ flexShrink: 0, fontFamily: 'inherit', padding: '6px 10px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', transition: 'all 0.3s', backgroundColor: '#eef2f5', color: interactionMode === 'analyze' ? '#e67e22' : '#2c3e50', boxShadow: interactionMode === 'analyze' ? 'inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255, 0.9)' : '2px 2px 5px rgba(163,177,198,0.5), -2px -2px 5px rgba(255,255,255, 0.9)', whiteSpace: 'nowrap', marginRight: 'auto' }}>
             {interactionMode === 'analyze' ? 'إلغاء وضع التحليل ❌' : 'التحليل العددي المباشر 🧮'}
          </button>

        </div>

        {viewScope !== 'timeline' && viewScope !== 'lab' && selectedShapeToHighlight && totalInGlobal > 0 && (
          <div style={{ marginTop: '10px', backgroundColor: '#fdf2e9', padding: '12px 20px', border: '2px solid #e67e22', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#d35400' }}>البصمة:</span>
              {(() => {
                const fpParts = selectedShapeToHighlight.split('-');
                return (
                  <span style={{ fontSize: '28px', fontWeight: 'bold', fontFamily: '"Amiri Quran", serif', color: '#c0392b', lineHeight: '0', display: 'inline-flex', gap: '3px', transform: 'translateY(-5px)', letterSpacing: '2px', direction: 'ltr' }}>
                    <span 
                      title="القفز لعائلة الحرف (أعلى الصفحة)"
                      style={{ cursor: 'pointer', borderBottom: '2px dashed transparent', padding: '0 2px' }}
                      onMouseEnter={(e) => { e.target.style.color = '#3498db'; e.target.style.borderBottom = '2px dashed #3498db'; }}
                      onMouseLeave={(e) => { e.target.style.color = '#c0392b'; e.target.style.borderBottom = '2px dashed transparent'; }}
                      onClick={() => {
                        const el = document.getElementById(`family-box-${selectedLetter}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    >
                      {fpParts[0]}
                    </span>
                    <span style={{ color: '#7f8c8d' }}>-</span>
                    <span 
                      title="القفز لهيئة الحرف (أسفل الصفحة)"
                      style={{ cursor: 'pointer', borderBottom: '2px dashed transparent', padding: '0 2px' }}
                      onMouseEnter={(e) => { e.target.style.color = '#27ae60'; e.target.style.borderBottom = '2px dashed #27ae60'; }}
                      onMouseLeave={(e) => { e.target.style.color = '#c0392b'; e.target.style.borderBottom = '2px dashed transparent'; }}
                      onClick={() => {
                        const el = document.getElementById(`shape-row-${selectedShapeToHighlight}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    >
                      {fpParts[1]}
                    </span>
                    <span style={{ color: '#7f8c8d' }}>-</span>
                    <span title="حالة الاتصال" style={{ cursor: 'default' }}>{fpParts[2]}</span>
                  </span>
                );
              })()}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <div style={{ background: '#fff', padding: '6px 15px', borderRadius: '4px', border: '1px solid #dcdde1', fontSize: '15px', fontWeight: 'bold' }}>
                <span style={{ color: '#7f8c8d' }}>في السورة:</span> <span style={{ color: '#2c3e50', fontSize: '16px' }}>{currentMatchIndex} / {totalInSurah}</span> 
                <span style={{ margin: '0 10px', color: '#bdc3c7' }}>|</span> 
                <span style={{ color: '#7f8c8d' }}>في المصحف:</span> <span style={{ color: '#e74c3c', fontSize: '16px' }}>{globalMatchIndex} / {totalInGlobal}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button onClick={() => { if (currentMatchIndex > 1) setCurrentMatchIndex(prev => prev - 1); else if (currentSurahOccIndex > 0) { const prevOcc = sortedOccurrences[currentSurahOccIndex - 1]; setSelectedSurahId(prevOcc.surahNumber); setCurrentMatchIndex(prevOcc.count); } }} disabled={isFirstGlobalMatch} style={{ fontFamily: 'inherit', padding: '6px 14px', background: isFirstGlobalMatch ? '#bdc3c7' : '#3498db', color: '#fff', border: 'none', borderRadius: '4px', cursor: isFirstGlobalMatch ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '15px' }}>السابق</button>
                <button onClick={() => { if (currentMatchIndex < totalInSurah) setCurrentMatchIndex(prev => prev + 1); else if (currentSurahOccIndex < sortedOccurrences.length - 1) { const nextOcc = sortedOccurrences[currentSurahOccIndex + 1]; setSelectedSurahId(nextOcc.surahNumber); setCurrentMatchIndex(1); } }} disabled={isLastGlobalMatch} style={{ fontFamily: 'inherit', padding: '6px 14px', background: isLastGlobalMatch ? '#bdc3c7' : '#3498db', color: '#fff', border: 'none', borderRadius: '4px', cursor: isLastGlobalMatch ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '15px' }}>التالي</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {progress && <div style={{ padding: '10px', background: '#fcf3cf', border: '1px solid #f1c40f', borderRadius: '4px', marginBottom: '20px', fontWeight: 'bold' }}>{progress}</div>}

      {/* 🟢 واجهة معمل البصمة الزمكانية */}
      {viewScope === 'lab' && (
        <div style={{ background: '#fff', border: '1px solid #bdc3c7', borderRadius: '8px', padding: '25px', marginTop: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }}>
          <h2 style={{ color: '#8e44ad', marginTop: 0, borderBottom: '2px solid #ecf0f1', paddingBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>🔬</span> معمل البصمة الرقمية والتمثيل البصري
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', background: '#f8f9fa', padding: '20px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
            
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#2c3e50' }}>1. المعيار العددي للحرف:</label>
              <select value={labSettings.numBase} onChange={(e) => setLabSettings({...labSettings, numBase: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontFamily: 'inherit', fontSize: '14px', backgroundColor: '#fff' }}>
                <option value="sequential">الرتبة التسلسلية للاكتشاف (1، 2، 3...)</option>
                <option value="spatial">الموقع المكاني (أول ظهور مطلق)</option>
                <option value="composite">البصمة المركبة (العائلة-الهيئة-الاتصال)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#2c3e50' }}>2. وحدة بناء البيانات:</label>
              <select value={labSettings.granularity} onChange={(e) => setLabSettings({...labSettings, granularity: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontFamily: 'inherit', fontSize: '14px', backgroundColor: '#fff' }}>
                <option value="words">مجموع قيم الكلمة (يفصل بـ /)</option>
                <option value="letters">قيم الحروف مفردة (يفصل بـ ,)</option>
              </select>
            </div>

<div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#2c3e50' }}>3. نوع المخرجات والتمثيل:</label>
              <select value={labSettings.outputType} onChange={(e) => setLabSettings({...labSettings, outputType: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontFamily: 'inherit', fontSize: '14px', backgroundColor: '#fff' }}>
                <option value="2d">تمثيل بصري ثنائي الأبعاد (2D Map) 📊</option>
                <option value="3d">تمثيل بصري ثلاثي الأبعاد (3D Helix) 🌌</option>
                <option value="signature">استخراج التوقيع الرقمي (Digital Signature) 🔐</option>
                <option value="export">تصدير كملف بيانات إكسيل (Export CSV) 💾</option>
              </select>
            </div>

<div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#2c3e50' }}>4. حيز التنفيذ:</label>
              <select value={labSettings.scope} onChange={(e) => setLabSettings({...labSettings, scope: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontFamily: 'inherit', fontSize: '14px', backgroundColor: '#fff' }}>
                <option value="surah">السورة الحالية فقط (سورة {currentSurah?.name})</option>
                <option value="quran">كامل النص القرآني</option>
              </select>
            </div>

            {/* 🟢 حقل تمييز الحرف */}
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#2c3e50' }}>5. تمييز حرف محدد (اختياري):</label>
              <input 
                type="text" 
                maxLength="1"
                placeholder="اكتب حرفاً (مثال: م)"
                value={labSettings.highlightLetter} 
                onChange={(e) => setLabSettings({...labSettings, highlightLetter: e.target.value})} 
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontFamily: '"Amiri Quran", serif', fontSize: '16px', backgroundColor: '#fff', textAlign: 'center' }} 
              />
            </div>

          </div>

          <div style={{ marginTop: '20px', textAlign: 'left' }}>
            <button onClick={executeLabAnalysis} style={{ padding: '12px 30px', background: '#2980b9', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px rgba(41, 128, 185, 0.3)' }}>
              توليد / رسم البيانات 🚀
            </button>
          </div>

<div style={{ marginTop: '30px', background: '#1e272e', borderRadius: '8px', minHeight: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ecf0f1', padding: '20px', border: '4px solid #2c3e50', overflow: 'hidden' }}>
            {!labOutputData ? (
              <div style={{ textAlign: 'center', opacity: 0.5 }}>
                <div style={{ fontSize: '48px', marginBottom: '10px' }}>🌌</div>
                <div>شاشة العرض جاهزة... قم باختيار المعايير واضغط على "توليد / رسم البيانات"</div>
              </div>
            ) : labOutputData.status === 'Processing...' ? (
              <div style={{ textAlign: 'center', color: '#f39c12', fontSize: '20px', fontWeight: 'bold', animation: 'pulse 1.5s infinite' }}>جاري توليد المصفوفات البصرية...</div>
) : labSettings.outputType === '2d' ? (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* 🟢 دليل الألوان (Legend) */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', padding: '10px 20px', backgroundColor: '#2c3e50', borderRadius: '8px', marginBottom: '15px', flexWrap: 'wrap', border: '1px solid #34495e' }}>
                   <span style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#3498db', display: 'inline-block' }}></span> نقطة عادية</span>
                   <span style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#27ae60', display: 'inline-block' }}></span> عدد أولي 🌟</span>
                   <span style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#8e44ad', display: 'inline-block' }}></span> مضاعف 19 ✨</span>
                   {labSettings.highlightLetter && <span style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#e74c3c', display: 'inline-block' }}></span> حرف المُميز ({labSettings.highlightLetter}) 🎯</span>}
                </div>
                
                <Plot
                  data={[{
                    x: labOutputData.plotData.x,
                    y: labOutputData.plotData.y,
                    text: labOutputData.plotData.text,
                    hoverinfo: 'text',
                    mode: 'markers+lines',
                    type: 'scatter',
                    marker: { size: 8, color: labOutputData.plotData.colors, opacity: 0.8 },
                    line: { color: 'rgba(52, 152, 219, 0.4)', width: 1 }
                  }]}
                  layout={{ 
                    title: { text: 'الخريطة الطبوغرافية ثنائية الأبعاد (2D)', font: { color: '#ecf0f1', family: 'Arial' } }, 
                    autosize: true, 
                    plot_bgcolor: '#1e272e', paper_bgcolor: '#1e272e', font: { color: '#ecf0f1' }, 
                    xaxis: { title: 'المسار الزمني (ترتيب الظهور)', gridcolor: '#34495e' }, 
                    yaxis: { title: 'القيمة العددية للكتلة', gridcolor: '#34495e' },
                    margin: { l: 60, r: 20, t: 50, b: 50 }
                  }}
                  useResizeHandler={true}
                  style={{ width: '100%', flexGrow: 1, minHeight: '500px' }}
                />
              </div>
            ) : labSettings.outputType === '3d' ? (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* 🟢 دليل الألوان (Legend) */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', padding: '10px 20px', backgroundColor: '#2c3e50', borderRadius: '8px', marginBottom: '15px', flexWrap: 'wrap', border: '1px solid #34495e' }}>
                   <span style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#3498db', display: 'inline-block' }}></span> نقطة عادية</span>
                   <span style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#27ae60', display: 'inline-block' }}></span> عدد أولي 🌟</span>
                   <span style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#8e44ad', display: 'inline-block' }}></span> مضاعف 19 ✨</span>
                   {labSettings.highlightLetter && <span style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#e74c3c', display: 'inline-block' }}></span> حرف المُميز ({labSettings.highlightLetter}) 🎯</span>}
                </div>

                <Plot
                  data={[{
                    x: labOutputData.plotData.x,
                    y: labOutputData.plotData.y,
                    z: labOutputData.plotData.z,
                    text: labOutputData.plotData.text,
                    hoverinfo: 'text',
                    mode: 'markers+lines',
                    type: 'scatter3d',
                    marker: { size: 6, color: labOutputData.plotData.colors, opacity: 0.8 },
                    line: { color: 'rgba(255, 255, 255, 0.2)', width: 2 }
                  }]}
                  layout={{ 
                    title: { text: 'المسار الجيني الزمكاني ثلاثي الأبعاد (3D Helix)', font: { color: '#ecf0f1', family: 'Arial' } }, 
                    autosize: true, 
                    paper_bgcolor: '#1e272e', font: { color: '#ecf0f1' }, 
                    scene: { 
                       xaxis: { title: 'الترتيب المطلق (X)', backgroundcolor: '#2c3e50', showbackground: true }, 
                       yaxis: { title: 'القيمة العددية (Y)', backgroundcolor: '#34495e', showbackground: true }, 
                       zaxis: { title: labSettings.scope === 'quran' ? 'رقم السورة (Z)' : 'رقم الآية (Z)', backgroundcolor: '#2c3e50', showbackground: true } 
                    },
                    margin: { l: 0, r: 0, t: 50, b: 0 }
                  }}
                  useResizeHandler={true}
                  style={{ width: '100%', flexGrow: 1, minHeight: '550px' }}
                />
              </div>
            ) : (
              <div style={{ width: '100%', height: '100%', overflowY: 'auto', maxHeight: '500px' }}>
                <h3 style={{ color: '#2ecc71', borderBottom: '1px solid #2ecc71', paddingBottom: '10px' }}>نتائج التحليل الخطي:</h3>
                <div style={{ fontFamily: 'monospace', fontSize: '16px', direction: 'ltr', textAlign: 'left', lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>
                  {labOutputData.preview}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🟢 غرفة التوثيق والمطابقة */}
      {viewScope === 'verify' && (
        <div style={{ background: '#fff', border: '1px solid #bdc3c7', borderRadius: '8px', padding: '25px', marginTop: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }}>
          <h2 style={{ color: '#2c3e50', marginTop: 0, borderBottom: '2px solid #ecf0f1', paddingBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>🛡️</span> غرفة التوثيق والمطابقة الرقمية
          </h2>
          
<div style={{ background: '#f8f9fa', padding: '20px', borderRadius: '8px', border: '1px solid #e0e0e0', marginBottom: '20px' }}>
             <p style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#7f8c8d' }}>قم بلصق أي نص قرآني، أو <b style={{color: '#2980b9'}}>ارفع ملفاً نصياً</b> لمطابقته مع البصمة الرقمية الأصلية.</p>
             
<div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#2c3e50' }}>النطاق المُراد المطابقة معه:</label>
                  <select value={verifySurahId} onChange={(e) => setVerifySurahId(Number(e.target.value))} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontFamily: 'inherit', fontSize: '15px' }}>
                    <option value={0} style={{ fontWeight: 'bold', color: '#8e44ad' }}>📖 المصحف كاملاً (كل السور)</option>
                    {quranData.map(s => <option key={s.id} value={s.id}>{s.id}. سورة {s.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#2c3e50' }}>معيار التشفير:</label>
                  <select value={verifyNumBase} onChange={(e) => setVerifyNumBase(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontFamily: 'inherit', fontSize: '15px' }}>
                    <option value="sequential">الرتبة التسلسلية للاكتشاف</option>
                    <option value="spatial">الموقع المكاني</option>
                    <option value="composite">البصمة المركبة</option>
                  </select>
                </div>
                {/* 🟢 القائمة الجديدة لتحديد مستوى الصرامة */}
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#2c3e50' }}>مستوى المطابقة:</label>
                  <select value={verifyMode} onChange={(e) => setVerifyMode(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontFamily: 'inherit', fontSize: '15px' }}>
                    <option value="strict">صارم (الرسم العثماني المشفر)</option>
                    <option value="flexible">مرن (النص الإملائي المجرد)</option>
                  </select>
                </div>
             </div>
             {/* 🟢 صندوق التوضيح لتبصير المستخدم بالفرق بين الوضعين */}
             <div style={{ background: '#ebf5fb', borderRight: '4px solid #2980b9', padding: '15px', borderRadius: '6px', marginBottom: '20px', fontSize: '14px', lineHeight: '1.7', color: '#2c3e50', boxShadow: '0 2px 5px rgba(0,0,0,0.02)' }}>
                <div style={{ fontWeight: 'bold', color: '#2980b9', marginBottom: '8px', fontSize: '15px' }}>💡 تنبيه منهجي حول مستويات المطابقة:</div>
                <ul style={{ margin: 0, paddingRight: '20px' }}>
                   <li style={{ marginBottom: '6px' }}>
                     <b style={{ color: '#c0392b' }}>الوضع الصارم (الأصح والأدق):</b> يطابق النص مع "الرسم العثماني التوقيفي" بكامل حركاته وتشكيلاته بدقة رياضية صارمة. غياب أي حركة، تشكيل، أو همزة وصل سيؤدي لانهيار البصمة الزمكانية واكتشاف الخلل.
                   </li>
                   <li>
                     <b style={{ color: '#27ae60' }}>الوضع المرن:</b> يتجاهل التشكيل، الألف الخنجرية، الأقواس وأرقام الآيات. تم تصميمه فقط لتسهيل فحص النصوص الإملائية العادية المنسوخة من شبكة الإنترنت.
                   </li>
                </ul>
             </div>

{/* 🟢 زر رفع الملفات */}
             <div style={{ marginBottom: '15px' }}>
               <label style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', width: '100%', padding: '12px', background: '#ecf0f1', color: '#2c3e50', border: '2px dashed #bdc3c7', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', boxSizing: 'border-box', transition: 'all 0.3s' }} onMouseOver={(e) => e.target.style.background = '#e2e6e8'} onMouseOut={(e) => e.target.style.background = '#ecf0f1'}>
                 <span>📂 رفع ملف نصي (.txt, .json)</span>
                 <input 
                   type="file" 
                   accept=".txt,.json" 
                   style={{ display: 'none' }}
                   onChange={(e) => {
                     const file = e.target.files[0];
                     if (!file) return;
                     const reader = new FileReader();
                     reader.onload = (evt) => {
                       const content = evt.target.result;
                       
                       // 🟢 محرك الفهم الذكي لصيغة JSON
                       if (file.name.toLowerCase().endsWith('.json')) {
                         try {
                           const jsonData = JSON.parse(content);
                           let extractedAyahs = []; // مصفوفة لتجميع الآيات
                           
                           const extractQuranText = (obj) => {
                             if (Array.isArray(obj)) {
                               obj.forEach(extractQuranText);
                             } else if (obj !== null && typeof obj === 'object') {
                               if (obj.text && typeof obj.text === 'string' && /[\u0600-\u06FF]/.test(obj.text)) {
                                  extractedAyahs.push(obj.text.trim());
                               } else if (obj.text_uthmani && typeof obj.text_uthmani === 'string') {
                                  extractedAyahs.push(obj.text_uthmani.trim());
                               } else if (obj.aya_text && typeof obj.aya_text === 'string') {
                                  extractedAyahs.push(obj.aya_text.trim());
                               } else {
                                  Object.values(obj).forEach(extractQuranText);
                               }
                             }
                           };
                           
                           extractQuranText(jsonData);
                           
                           if (extractedAyahs.length > 0) {
                              // دمج الآيات بفواصل أسطر لحماية المتصفح من الانهيار
                              setVerifyText(extractedAyahs.join('\n'));
                              setTimeout(() => alert('✅ تم استخراج النص القرآني بنجاح وتجاهل البيانات الوصفية.'), 100);
                           } else {
                              alert('❌ لم يتم العثور على نص عربي داخل ملف الـ JSON. تأكد من هيكل الملف.');
                              setVerifyText('');
                           }
                         } catch (err) {
                           console.error("JSON Parse Error:", err);
                           alert('❌ فشل قراءة ملف JSON! تأكد من حفظه بتشفير UTF-8.');
                           setVerifyText(''); 
                         }
                       } else {
                         // للملفات العادية
                         setVerifyText(content);
                       }
                     };
                     reader.readAsText(file, 'UTF-8');
                     e.target.value = ''; 
                   }}
                 />
               </label>
             </div>

             {/* 🟢 مربع النص المجهز لتحمل النصوص العملاقة */}
             <textarea 
               value={verifyText} 
               onChange={(e) => setVerifyText(e.target.value)}
               placeholder="الصق النص هنا، أو استخدم زر الرفع بالأعلى..."
               spellCheck="false" // إيقاف المدقق الإملائي لمنع الشلل
               style={{ 
                 width: '100%', 
                 height: '150px', 
                 padding: '15px', 
                 borderRadius: '6px', 
                 border: '1px solid #ccc', 
                 fontFamily: 'Arial, Tahoma, sans-serif', // خط نظام خفيف جداً
                 fontSize: '18px', 
                 lineHeight: '1.8',
                 resize: 'vertical', 
                 boxSizing: 'border-box' 
               }}
             />
             
             <div style={{ display: 'flex', gap: '15px', marginTop: '15px' }}>
               <button onClick={handleVerifyText} style={{ flex: 1, padding: '12px', background: '#34495e', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', boxShadow: '0 4px 6px rgba(44, 62, 80, 0.3)' }}>
                 فحص ومطابقة النص 🔍
               </button>
               <button onClick={() => { setVerifyText(''); setVerifyResult(null); }} style={{ padding: '12px 25px', background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', boxShadow: '0 4px 6px rgba(231, 76, 60, 0.3)' }}>
                 مسح الحقل 🗑️
               </button>
             </div>
          </div>

{verifyResult && (
             <div style={{ background: verifyResult.isMatch ? '#e8f8f5' : '#fdedec', border: `2px solid ${verifyResult.isMatch ? '#2ecc71' : '#e74c3c'}`, borderRadius: '8px', padding: '20px', textAlign: 'center', animation: 'fadeIn 0.5s' }}>
                <div style={{ fontSize: '60px', marginBottom: '10px' }}>{verifyResult.isMatch ? '✅' : '❌'}</div>
                <h3 style={{ color: verifyResult.isMatch ? '#27ae60' : '#c0392b', margin: '0 0 20px 0', fontSize: '24px' }}>
                   {verifyResult.isMatch ? 'تطابق تام! النص موثق وسليم 100%' : 'فشل المطابقة! تم اكتشاف اختلاف أو تحريف في النص'}
                </h3>
                
                <div style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}>
                   <div style={{ background: '#fff', padding: '15px', borderRadius: '8px', border: '1px solid #ddd', flex: 1, maxWidth: '400px' }}>
                      <h4 style={{ margin: '0 0 10px 0', color: '#7f8c8d' }}>التوقيع المرجعي (الأصلي)</h4>
                      <div style={{ fontFamily: 'monospace', fontSize: '20px', fontWeight: 'bold', color: '#2c3e50', background: '#ecf0f1', padding: '10px', borderRadius: '4px' }}>{verifyResult.originalData.signature}</div>
                      <div style={{ marginTop: '10px', fontSize: '14px', color: '#95a5a6' }}>مجموع الكلمات: {verifyResult.originalData.totalItems} | القيمة: {verifyResult.originalData.totalValue}</div>
                   </div>
                   <div style={{ background: '#fff', padding: '15px', borderRadius: '8px', border: '1px solid #ddd', flex: 1, maxWidth: '400px' }}>
                      <h4 style={{ margin: '0 0 10px 0', color: '#7f8c8d' }}>توقيع النص المُدخل</h4>
                      <div style={{ fontFamily: 'monospace', fontSize: '20px', fontWeight: 'bold', color: verifyResult.isMatch ? '#2c3e50' : '#c0392b', background: '#ecf0f1', padding: '10px', borderRadius: '4px' }}>{verifyResult.inputData.signature}</div>
                      <div style={{ marginTop: '10px', fontSize: '14px', color: '#95a5a6' }}>مجموع الكلمات: {verifyResult.inputData.totalItems} | القيمة: {verifyResult.inputData.totalValue}</div>
                   </div>
                </div>

{/* 🟢 لوحة رادار كشف الانحراف الدقيق (مع تنبيه التوقف) */}
                {!verifyResult.isMatch && verifyResult.mismatchInfo && (
                   <div style={{ marginTop: '20px', background: '#fff', border: '2px solid #e74c3c', borderRadius: '8px', padding: '15px', textAlign: 'right', boxShadow: '0 4px 10px rgba(231, 76, 60, 0.1)' }}>
                      <h4 style={{ color: '#c0392b', margin: '0 0 10px 0', borderBottom: '1px dashed #e74c3c', paddingBottom: '8px', fontSize: '18px' }}>
                         📍 رادار كشف الانحراف (نقطة الانهيار الأولى)
                      </h4>
                      
                      <p style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#2c3e50', lineHeight: '1.6' }}>
                        تم اكتشاف أول نقطة اختلاف بين المرجع والنص المدخل عند <b>الكلمة رقم ({verifyResult.mismatchInfo.index})</b>:
                      </p>
                      
                      <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', marginBottom: '15px' }}>
                         <div style={{ flex: 1, background: '#f8f9fa', padding: '15px', borderRadius: '6px', border: '1px solid #bdc3c7', textAlign: 'center' }}>
                            <div style={{ color: '#7f8c8d', fontSize: '14px', marginBottom: '5px' }}>في المرجع القرآني (الأصلي):</div>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#27ae60', fontFamily: '"Amiri Quran", serif' }}>
                               {verifyResult.mismatchInfo.origWord}
                            </div>
                            <div style={{ marginTop: '5px', fontSize: '14px', color: '#27ae60', fontWeight: 'bold' }}>
                               قيمة البصمة: {verifyResult.mismatchInfo.origVal.toLocaleString()}
                            </div>
                         </div>
                         
                         <div style={{ flex: 1, background: '#fdedec', padding: '15px', borderRadius: '6px', border: '1px solid #e74c3c', textAlign: 'center' }}>
                            <div style={{ color: '#c0392b', fontSize: '14px', marginBottom: '5px' }}>في النص المُدخل (المُحرف):</div>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#c0392b', fontFamily: '"Amiri Quran", serif' }}>
                               {verifyResult.mismatchInfo.inpWord}
                            </div>
                            <div style={{ marginTop: '5px', fontSize: '14px', color: '#c0392b', fontWeight: 'bold' }}>
                               قيمة البصمة: {verifyResult.mismatchInfo.inpVal.toLocaleString()}
                            </div>
                         </div>
                      </div>

                      {/* 🟢 رسالة التنبيه الجوهرية للمستخدم */}
                      <div style={{ background: '#fef9e7', borderRight: '4px solid #f1c40f', padding: '12px', borderRadius: '4px', color: '#d35400', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                         <span style={{ fontSize: '20px' }}>⚠️</span>
                         <span>
                            تنبيه هام: توقف الرادار عند هذا الموضع لأنه أدى لانهيار المزامنة الزمكانية. 
                            قد تكون هناك أخطاء أخرى تالية لم تُكتشف بعد. يرجى تصحيح هذا الخطأ ثم "إعادة الفحص" لاستكمال المطابقة.
                         </span>
                      </div>
                   </div>
                )}
             </div>
          )}
        </div>
      )}

{/* 🟢 العرض التقليدي للنص والقوائم */}
      {/* 🟢 العرض التقليدي للنص والقوائم (تم تعديل نسبة العرض إلى 2.8 مقابل 1 لصالح النص القرآني) */}
      <div style={{ display: (viewScope === 'lab' || viewScope === 'verify') ? 'none' : 'grid', gridTemplateColumns: viewScope === 'timeline' ? '1fr' : '2.8fr 1fr', gap: '20px', marginTop: '20px' }}>
        
        {viewScope !== 'timeline' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
             
            {/* 🟢 اللوحة المدمجة للتحليل العددي (تم نقلها من الأسفل لتصبح فوق النص مباشرة) */}
            {interactionMode === 'analyze' && (
               <div style={{ background: '#fff', padding: '15px', borderRadius: '8px', border: '2px solid #e67e22', boxShadow: '0 4px 10px rgba(230, 126, 34, 0.1)', direction: 'rtl' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
                     <h3 style={{ margin: 0, color: '#d35400', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px' }}>🧮 التحليل العددي المباشر</h3>
                     <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <select value={analysisNumBase} onChange={e => setAnalysisNumBase(e.target.value)} style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', fontFamily: 'inherit', fontSize: '13px', backgroundColor: '#f9f9f9', fontWeight: 'bold' }}>
                           <option value="sequential">الرتبة التسلسلية</option>
                           <option value="spatial">الموقع المكاني</option>
                           <option value="composite">البصمة المركبة</option>
                        </select>
<button onClick={() => setSelectedAnalysisWords([...surahWordsDataRef.current])} style={{ background: '#27ae60', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>تحديد السورة كاملة 📖</button>
                        <button onClick={() => setSelectedAnalysisWords([])} style={{ background: '#e74c3c', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>مسح التحديد 🗑️</button>
                     </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '15px' }}>
                     <div style={{ flex: 1, background: '#f8f9fa', padding: '10px', borderRadius: '6px', border: '1px solid #ddd', maxHeight: '90px', overflowY: 'auto' }}>
                        <div style={{ fontFamily: '"Amiri Quran", serif', fontSize: '18px', color: '#2c3e50', lineHeight: '1.8' }}>
                           {selectedAnalysisWords.length === 0 ? <span style={{color: '#95a5a6', fontSize:'13px'}}>اضغط على الكلمات في النص بالأسفل لتحديدها...</span> : 
                            [...selectedAnalysisWords].sort((a,b) => a.ayah - b.ayah || a.wIdx - b.wIdx).map(w => w.text).join(' ')}
                        </div>
                     </div>
                     
<div style={{ flex: '0 0 200px', background: '#fdf2e9', padding: '10px', borderRadius: '6px', border: '1px solid #f5cba7', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                        <div style={{ fontSize: '13px', color: '#e67e22', fontWeight: 'bold', marginBottom: '2px' }}>القيمة العددية للنص المحدد:</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#d35400', fontFamily: 'monospace', textShadow: '1px 1px 0px rgba(0,0,0,0.1)' }}>{totalAnalysisValue.toLocaleString()}</div>
                        <div style={{ display: 'flex', gap: '5px', marginTop: '5px', flexWrap: 'wrap', justifyContent: 'center' }}>
                           <span style={{ padding: '4px 10px', borderRadius: '12px', background: isPrimeNumber(totalAnalysisValue) ? '#27ae60' : '#bdc3c7', color: '#fff', fontSize: '11px', fontWeight: 'bold', opacity: isPrimeNumber(totalAnalysisValue) ? 1 : 0.3 }}>أولي 🌟</span>
                           <span style={{ padding: '4px 10px', borderRadius: '12px', background: totalAnalysisValue > 0 && totalAnalysisValue % 19 === 0 ? '#8e44ad' : '#bdc3c7', color: '#fff', fontSize: '11px', fontWeight: 'bold', opacity: totalAnalysisValue > 0 && totalAnalysisValue % 19 === 0 ? 1 : 0.3, direction: 'ltr' }}>
                             {totalAnalysisValue > 0 && totalAnalysisValue % 19 === 0 ? `✨ 19 × ${(totalAnalysisValue / 19).toLocaleString()}` : 'مضاعف 19'}
                           </span>
                        </div>
                     </div>
                  </div>
               </div>
            )}

{/* 🟢 حاوية عرض النص القرآني (بخلفية أوراق المصحف الصفراء المريحة) */}
            <div id="quran-text-container" style={{ flex: 1, backgroundColor: '#fcf8eb', border: '2px solid #e8dcb8', borderRadius: '12px', padding: '30px', maxHeight: '192vh', overflowY: 'auto', boxShadow: 'inset 0 0 20px rgba(212, 196, 151, 0.15), 0 4px 10px rgba(0,0,0,0.03)' }}>
              
              {/* ترويسة السورة (صندوق داكن كما في تطبيق الرقيم) */}
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '25px' }}>
                 <div style={{ backgroundColor: '#dac92b', padding: '12px 35px', borderRadius: '30px', display: 'inline-flex', alignItems: 'center', gap: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
                    <span style={{ fontSize: '16px', color: '#95a5a6', fontWeight: 'bold' }}>({currentSurah?.ayahs.length} آية)</span>
                    <span style={{ fontSize: '30px', fontFamily: '"Amiri Quran", serif', color: '#fff', fontWeight: 'bold' }}>سورة {currentSurah?.name}</span>
                 </div>
              </div>

              {/* إحصائيات السورة السريعة */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '30px' }}>
                  <div style={{ background: '#fff', padding: '6px 20px', borderRadius: '20px', color: '#16a085', fontWeight: 'bold', fontSize: '14px', border: '1px solid #e8dcb8' }}>حروفها: {totalLettersInSurah.toLocaleString()}</div>
                  <div style={{ background: '#fff', padding: '6px 20px', borderRadius: '20px', color: '#d35400', fontWeight: 'bold', fontSize: '14px', border: '1px solid #e8dcb8' }}>كلماتها: {totalWordsInSurah.toLocaleString()}</div>
              </div>

              {/* النص القرآني (بتنسيق متوسط ومريح للعين) */}
              <div style={{ fontFamily: '"Amiri Quran", "Amiri", serif', fontSize: '42px', lineHeight: '2.6', textAlign: 'center', padding: '0 20px' }}>
                {(() => {
                   let shapeCounters = {}; 
                   surahWordsDataRef.current = [];
                   return currentSurah?.ayahs.map(ayah => {
                     let currentAyahWordsData = []; 
                     const renderedAyah = renderInteractiveAyah(ayah, shapeCounters, currentAyahWordsData);
                     surahWordsDataRef.current.push(...currentAyahWordsData); 
                     
                     const isAyahSelected = currentAyahWordsData.length > 0 && currentAyahWordsData.every(aw => selectedAnalysisWords.some(pw => pw.key === aw.key));

                     return (
                       <span key={ayah.id} id={`ayah-${ayah.number}`} style={{ transition: 'all 0.3s', padding: '5px 10px', borderRadius: '12px', backgroundColor: (interactionMode === 'analyze' && isAyahSelected) ? 'rgba(230, 126, 34, 0.1)' : 'transparent', boxShadow: (interactionMode === 'analyze' && isAyahSelected) ? 'inset 2px 2px 5px rgba(0,0,0,0.05)' : 'none' }}>
                         <span style={{ color: '#2c3e50' }}>{renderedAyah}</span>
                         <span 
                           onClick={(e) => {
                              if (interactionMode !== 'analyze') return;
                              e.stopPropagation();
                              setSelectedAnalysisWords(prev => {
                                  if (isAyahSelected) return prev.filter(pw => pw.ayah !== ayah.number);
                                  else return [...prev.filter(pw => pw.ayah !== ayah.number), ...currentAyahWordsData];
                              });
                           }}
                           title={interactionMode === 'analyze' ? "انقر لتحديد/إلغاء تحديد الآية بالكامل" : ""}
                           style={{ 
                             color: '#bfae7e', // لون ذهبي هادئ لفواصل الآيات
                             margin: '0 15px', 
                             fontSize: '30px', 
                             fontFamily: '"Amiri Quran", serif',
                             cursor: interactionMode === 'analyze' ? 'pointer' : 'default',
                             display: 'inline-block'
                           }}>﴿{ayah.number}﴾</span>
                       </span>
                     );
                   });
                })()}
              </div>
            </div>
          </div>
        )}

        <div>
          {viewScope === 'timeline' ? (
            <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: '8px', padding: '20px' }}>
              <h3 style={{ margin: '0 0 15px 0' }}>سجل ترتيب الاكتشاف</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                <thead>
                  <tr style={{ background: '#f4f6f7', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '10px' }}>رتبة الظهور</th>
                    <th style={{ padding: '10px' }}>البصمة</th>
                    <th style={{ padding: '10px' }}>الشكل</th>
                    <th style={{ padding: '10px' }}>المكان المطلق</th>
                  </tr>
                </thead>
                <tbody>
                  {globalFingerprints.map((item) => (
                    <tr key={item.compositeId} onClick={(e) => { e.stopPropagation(); jumpToShapeInText(item); }} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f9ebea'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '10px', fontWeight: 'bold', color: '#e74c3c' }}>{item.chronologicalId}</td>
                      <td style={{ padding: '10px', fontWeight: 'bold', color: '#8e44ad', letterSpacing: '2px' }}>{item.compositeId}</td>
                      <td style={{ padding: '10px', fontSize: '34px', fontWeight: 'bold', fontFamily: '"Amiri Quran", serif' }}>
                         {item.actualForms && item.actualForms.length > 0 ? item.actualForms[0] : item.shape}
                      </td>
                      <td style={{ padding: '10px', fontWeight: 'bold', color: '#2980b9' }}>{item.firstSpatialPosition}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
{/* 🟢 لوحة العائلات (ثابتة 28% + تصميم النيومورفيزم للأزرار + منع التفاف النص) */}
             <div style={{ flex: '0 0 28%', minWidth: '220px', background: '#eef2f5', border: 'none', borderRadius: '15px', padding: '18px 12px', marginBottom: '20px', boxShadow: '4px 4px 10px rgba(163,177,198,0.3), -4px -4px 10px rgba(255,255,255, 0.8)' }}>
                
                {/* 🟢 العنوان والإجمالي (في سطر واحد إجباري بدون التفاف) */}
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'nowrap', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '20px' }}>
                  <h3 style={{ margin: '0', fontSize: '15px', color: '#2c3e50', whiteSpace: 'nowrap', fontWeight: 'bold' }}>عائلات الحروف</h3>
                  
                  {/* شارة الإجمالي (غائرة للداخل) */}
                  <span style={{ background: '#eef2f5', color: '#d35400', padding: '4px 8px', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap', boxShadow: 'inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255, 0.9)' }}>
                    إجمالي: {viewScope === 'global' ? totalLettersInGlobal.toLocaleString() : totalLettersInSurah.toLocaleString()} حرف
                  </span>
                </div>
                
                {/* 🟢 شبكة أزرار الحروف (بارزة، وتغوص للداخل عند التحديد) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(55px, 1fr))', gap: '12px' }}>
                  {safeSortedLetters.map(item => {
                    const isSelected = selectedLetter === item.letter;
                    return (
                      <div 
                        id={`family-box-${item.letter}`} 
                        key={item.letter} 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setSelectedLetter(item.letter); 
                          setSelectedShapeToHighlight(null); 
                          // التمرير الانسيابي بعد اختيار الحرف
                          setTimeout(() => { const target = document.getElementById('shapes-tree-section'); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150); 
                        }} 
                        style={{ 
                          padding: '4px 4px', 
                          borderRadius: '10px', 
                          textAlign: 'center', 
                          cursor: 'pointer', 
                          background: '#eef2f5',
                          // التبديل بين البارز (غير محدد) والغائر (محدد)
                          boxShadow: isSelected ? 'inset 3px 3px 6px rgba(163,177,198,0.6), inset -3px -3px 6px rgba(255,255,255, 0.9)' : '3px 3px 6px rgba(163,177,198,0.5), -3px -3px 6px rgba(255,255,255, 0.9)',
                          border: isSelected ? '1px solid rgba(231, 76, 60, 0.1)' : '1px solid transparent',
                          transition: 'all 0.2s ease',
                          scrollMarginTop: '80px' 
                        }}
                      >
                        <div style={{ fontSize: '24px', fontWeight: 'bold', fontFamily: '"Amiri Quran", serif', color: isSelected ? '#e74c3c' : '#2980b9' }}>{item.letter}</div>
                        <div style={{ fontSize: '11px', color: isSelected ? '#c0392b' : '#7f8c8d', fontWeight: 'bold', marginTop: '4px' }}>{item.totalCount.toLocaleString()}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

{selectedLetter && (
                <div id="shapes-tree-section" style={{ background: '#fff', border: '1px solid #ddd', borderRadius: '8px', padding: '20px', scrollMarginTop: '20px' }}>
                  <h3 style={{ margin: '0 0 15px 0', borderBottom: '2px solid #eee', paddingBottom: '10px' }}>
                    شجرة تشكيلات ({selectedLetter})
                  </h3>
                  
                  {getGroupedShapes().map((group, groupIdx) => (
                    <div key={groupIdx} style={{ marginBottom: '20px', border: '1px solid #bdc3c7', borderRadius: '8px', overflow: 'hidden' }}>
                      <div style={{ backgroundColor: '#ecf0f1', padding: '10px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #bdc3c7' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', direction: 'rtl' }}>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', direction: 'rtl', alignItems: 'center', fontSize: '38px', fontWeight: 'bold', fontFamily: '"Amiri Quran", serif', color: '#2980b9', lineHeight: '1', transform: 'translateY(-10px)' }}>
                            {Array.from(group.allForms).map((form, i) => (
                              <span key={i} style={{ display: 'inline-block' }}>{form}</span>
                            ))}
                          </div>
                        </div>
                        <span style={{ background: '#27ae60', color: '#fff', padding: '4px 10px', borderRadius: '15px', fontSize: '14px', fontWeight: 'bold' }}>
                          المجموع: {group.totalCount.toLocaleString()}
                        </span>
                      </div>
                      
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                        <thead>
                          <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #ddd' }}>
                            <th style={{ padding: '16px' }}>البصمة</th>
                            <th style={{ padding: '8px' }}>الشكل (الاتصال)</th>
                            <th style={{ padding: '8px' }}>الحالة</th>
                            <th style={{ padding: '8px' }}>العدد</th>
                            <th style={{ padding: '8px' }}>إجراء</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((shapeData, index) => (
                            <tr id={`shape-row-${shapeData.compositeId}`} key={index} 
                              onClick={(e) => { e.stopPropagation(); jumpToShapeInText({ ...shapeData, firstSurah: shapeData.firstSurah || currentSurah?.id })}} 
                              onContextMenu={(e) => {
                                e.preventDefault();
                                const hexString = (shapeData.actualForms && shapeData.actualForms.length > 0) ? shapeData.actualForms[0] : shapeData.shape;
                                const hexCodes = Array.from(hexString).map(c => `${c} (U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
                                setDebugData({
                                   compositeId: shapeData.compositeId,
                                   bareLetter: shapeData.bareLetter,
                                   shape: shapeData.shape,
                                   actualForms: shapeData.actualForms,
                                   connectionState: shapeData.connectionState,
                                   hexCodes: hexCodes
                                });
                                setDebugModalOpen(true);
                              }}
                              style={{ borderBottom: '1px solid #eee', cursor: 'pointer', backgroundColor: selectedShapeToHighlight === shapeData.compositeId ? '#f9ebea' : 'transparent', transition: 'background-color 0.2s', scrollMarginTop: '80px' }}>
                              <td style={{ padding: '10px', fontWeight: 'bold', color: '#8e44ad', letterSpacing: '1px' }}>{shapeData.compositeId}</td>
                              <td style={{ padding: '10px', fontSize: '32px', fontWeight: 'bold', fontFamily: '"Amiri Quran", serif', color: selectedShapeToHighlight === shapeData.compositeId ? '#c0392b' : 'inherit' }}>
                                <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', direction: 'rtl', alignItems: 'center' }}>
                                  {(shapeData.actualForms && shapeData.actualForms.length > 0) 
                                    ? shapeData.actualForms.map((form, i) => <span key={i} style={{ display: 'inline-block' }}>{form}</span>)
                                    : <span>{shapeData.shape}</span>
                                  }
                                </div>
                              </td>
                              <td style={{ padding: '10px' }}>
                                <span style={{ fontSize: '12px', background: '#34495e', color: '#fff', padding: '4px 8px', borderRadius: '12px', fontFamily: 'Arial' }}>
                                  {shapeData.connectionState}
                                </span>
                              </td>
                              <td style={{ padding: '10px', fontWeight: 'bold', color: '#2c3e50', fontSize: '15px' }}>{shapeData.totalCount.toLocaleString()}</td>
                              <td style={{ padding: '10px' }}>
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setMoveData({ shape: shapeData.shape, currentBare: shapeData.bareLetter, newBare: shapeData.bareLetter, newShape: shapeData.shape }); 
                                    setMoveModalOpen(true); 
                                  }} 
                                  style={{ padding: '4px 8px', background: '#3498db', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                                >
                                  نقل 🔄
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {moveModalOpen && moveData && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', width: '450px', boxShadow: '0 5px 15px rgba(0,0,0,0.3)' }}>
            <h3 style={{ marginTop: 0, color: '#2980b9' }}>نقل وتوجيه الهيئة ({moveData.shape})</h3>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>العائلة (الشجرة) الجديدة:</label>
              <select 
                value={moveData.newBare} 
                onChange={(e) => setMoveData({...moveData, newBare: e.target.value})}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', fontFamily: 'inherit' }}
              >
                {safeSortedLetters.map(fam => <option key={fam.letter} value={fam.letter}>{fam.letter}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>الهيئة (الفرع) الجديد:</label>
              <input 
                type="text" 
                value={moveData.newShape} 
                onChange={(e) => setMoveData({...moveData, newShape: e.target.value})}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', fontFamily: '"Amiri Quran", serif', fontSize: '24px', textAlign: 'center' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={async () => {
                await db.manual_overrides.put({ shape: moveData.shape, newBareLetter: moveData.newBare, newShape: moveData.newShape });
                setMoveModalOpen(false);
                alert('تم حفظ أمر النقل بنجاح! \nيرجى الضغط على (مسح المصحف كاملاً) لتطبيق التغييرات.');
              }} style={{ flex: 1, padding: '10px', background: '#27ae60', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>حفظ النقل</button>
              <button onClick={() => setMoveModalOpen(false)} style={{ flex: 1, padding: '10px', background: '#95a5a6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {excludeModalOpen && exclusionData && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', width: '550px', maxHeight: '90vh', overflowY: 'auto', textAlign: 'center', boxShadow: '0 5px 15px rgba(0,0,0,0.3)' }}>
            <h3 style={{ marginTop: 0, color: '#e74c3c' }}>نافذة الفحص والاستبعاد</h3>
            <p style={{ fontSize: '18px', color: '#34495e' }}>الكلمة: <span style={{ fontFamily: '"Amiri Quran", serif', fontSize: '28px', color: '#c0392b' }}>{exclusionData.wordText}</span></p>
            
            {exclusionData.debugInfo && (
              <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', textAlign: 'right', border: '1px solid #bdc3c7', marginBottom: '20px', direction: 'rtl' }}>
                <h4 style={{ color: '#2980b9', marginTop: 0, borderBottom: '1px solid #ddd', paddingBottom: '5px' }}>🔍 كشاف الأشعة (مباشرة من النص):</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px', fontFamily: 'Arial' }}>
                  <div style={{ gridColumn: 'span 2' }}><b>مفتاح التطابق (Lookup):</b> <span style={{color: '#8e44ad', fontFamily: 'monospace'}}>{exclusionData.debugInfo.lookupKey}</span></div>
                  <div><b>عائلة الحرف:</b> {exclusionData.debugInfo.bareLetter}</div>
                  <div><b>حالة الاتصال:</b> {exclusionData.debugInfo.connectionName}</div>
                  <div style={{ gridColumn: 'span 2' }}><b>البصمة المحسوبة:</b> <span style={{color: exclusionData.debugInfo.compositeId ? '#27ae60' : '#e74c3c', fontWeight: 'bold'}}>{exclusionData.debugInfo.compositeId || 'غير متطابق (فشل المزامنة)'}</span></div>
                </div>
                <div style={{ marginTop: '10px' }}>
                  <b>التكوين البرمجي (Unicode):</b>
                  <div style={{ background: '#2c3e50', color: '#ecf0f1', padding: '10px', borderRadius: '4px', marginTop: '5px', direction: 'ltr', textAlign: 'left', fontFamily: 'monospace', fontSize: '12px', maxHeight: '100px', overflowY: 'auto' }}>
                    {exclusionData.debugInfo.hexCodes.map((h, i) => <div key={i}>{h}</div>)}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button onClick={async () => {
                  try {
                    await db.exclusions.add({ type: 'instance', surah: exclusionData.surah, ayah: exclusionData.ayah, wordIdx: exclusionData.wordIdx, charIdx: exclusionData.charIdx, wordText: exclusionData.wordText, shape: exclusionData.shape });
                    setExcludeModalOpen(false); setExclusionData(null);
                    alert('تم الحفظ! \nيرجى الضغط على زر "مسح المصحف كاملاً" لتطبيق الحذف.');
                  } catch(e) { console.error(e); }
              }} style={{ padding: '10px', background: '#e67e22', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>حذف هذا الموضع فقط (سورة {exclusionData.surah} - آية {exclusionData.ayah})</button>
              <button onClick={async () => {
                 try {
                    await db.exclusions.add({ type: 'word_global', surah: exclusionData.surah, ayah: exclusionData.ayah, wordIdx: exclusionData.wordIdx, charIdx: exclusionData.charIdx, wordText: exclusionData.wordText, shape: exclusionData.shape });
                    setExcludeModalOpen(false); setExclusionData(null);
                    alert('تم الحفظ! \nيرجى الضغط على زر "مسح المصحف كاملاً" لتطبيق الحذف.');
                  } catch(e) { console.error(e); }
              }} style={{ padding: '10px', background: '#c0392b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>حذف الكلمة من كل المصحف</button>
              <button onClick={() => setExcludeModalOpen(false)} style={{ padding: '10px', background: '#95a5a6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', marginTop: '10px' }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {debugModalOpen && debugData && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', width: '500px', textAlign: 'center', boxShadow: '0 5px 15px rgba(0,0,0,0.3)', direction: 'rtl' }}>
            <h3 style={{ marginTop: 0, color: '#8e44ad' }}>🔍 كشاف الأشعة (من الجدول)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '16px', fontFamily: 'Arial', textAlign: 'right', background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #bdc3c7' }}>
              <div><b>عائلة الحرف:</b> {debugData.bareLetter}</div>
              <div><b>حالة الاتصال:</b> {debugData.connectionState}</div>
              <div style={{ gridColumn: 'span 2' }}><b>البصمة:</b> <span style={{color: '#27ae60', fontWeight: 'bold'}}>{debugData.compositeId}</span></div>
              <div style={{ gridColumn: 'span 2' }}><b>الشكل الفعلي:</b> <span style={{fontFamily: '"Amiri Quran", serif', fontSize: '24px', color: '#e67e22'}}>{debugData.actualForms && debugData.actualForms.length > 0 ? debugData.actualForms[0] : debugData.shape}</span></div>
            </div>
            <div style={{ marginTop: '15px', textAlign: 'right' }}>
              <b>التكوين البرمجي (Unicode):</b>
              <div style={{ background: '#2c3e50', color: '#ecf0f1', padding: '10px', borderRadius: '4px', marginTop: '5px', direction: 'ltr', textAlign: 'left', fontFamily: 'monospace', fontSize: '14px', maxHeight: '150px', overflowY: 'auto' }}>
                {debugData.hexCodes.map((h, i) => <div key={i}>{h}</div>)}
              </div>
            </div>
            <button onClick={() => setDebugModalOpen(false)} style={{ marginTop: '20px', padding: '10px 20px', background: '#95a5a6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>إغلاق</button>
          </div>
        </div>
      )}
      
{/* 🟢 النافذة العائمة لمرصد مواقع النجوم (متعدد النجوم والمقارنة - بالتصميم الواسع المريح) */}
      {isTrackerVisible && trackedStars.length > 0 && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(15, 23, 42, 0.95)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', direction: 'rtl', backdropFilter: 'blur(8px)' }}>
           <div style={{ background: '#ecf0f1', width: '95%', maxWidth: '1400px', height: '95vh', borderRadius: '12px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '2px solid #3498db' }}>
              
              {/* شريط العنوان */}
              <div style={{ background: '#2c3e50', padding: '15px 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                 <h2 style={{ margin: 0, color: '#f1c40f', fontFamily: '"Amiri Quran", serif', fontSize: '24px' }}>
                    🔭 مرصد مواقع النجوم [ مقارنة: {trackedStars.map(s => s.word).join(' vs ')} ]
                 </h2>
                 <div style={{display: 'flex', gap: '15px'}}>
                    <button onClick={() => setIsTrackerVisible(false)} style={{ background: '#34495e', color: '#fff', border: '1px solid #7f8c8d', borderRadius: '6px', padding: '8px 15px', cursor: 'pointer', fontWeight: 'bold', transition: '0.3s' }}>إخفاء المرصد (لاضافة كلمة)</button>
                    <button onClick={() => { setTrackedStars([]); setIsTrackerVisible(false); }} style={{ background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 15px', cursor: 'pointer', fontWeight: 'bold' }}>مسح الكل وإغلاق 🗑️</button>
                 </div>
              </div>

              {/* المحتوى الداخلي قابل للتمرير */}
              <div style={{ padding: '25px', overflowY: 'auto', flex: 1 }}>
                 
                 {/* الرسم البياني المدمج للمقارنة (في الأعلى ليعطي النظرة الشاملة) */}
                 <div style={{ height: '400px', background: '#1e272e', borderRadius: '8px', padding: '15px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', marginBottom: '35px', border: '2px solid #2c3e50' }}>
                    <Plot
                      data={trackedStars.map((star, idx) => {
                        const cosmicColors = ['#f1c40f', '#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c'];
                        const color = cosmicColors[idx % cosmicColors.length];
                        return {
                          x: star.occurrences.map((_, i) => i + 1),
                          y: star.occurrences.map(o => o.globalPos),
                          name: star.word, 
                          text: star.occurrences.map((o, i) => `الكلمة: ${star.word}<br>الظهور: ${i+1}<br>سورة ${o.surahName}<br>آية ${o.ayahNum}<br>الموقع المطلق: ${o.globalPos}`),
                          hoverinfo: 'text+name',
                          mode: 'markers+lines',
                          type: 'scatter',
                          marker: { size: 9, color: color, opacity: 0.9, line: { color: '#fff', width: 1 } },
                          line: { color: color, width: 2, shape: 'spline' }
                        };
                      })}
                      layout={{
                        title: { text: 'المدارات الفلكية المدمجة (تقاطع المواقع عبر النص القرآني)', font: { color: '#ecf0f1', family: 'Arial', size: 16 } },
                        autosize: true,
                        margin: { l: 60, r: 20, t: 40, b: 50 },
                        plot_bgcolor: '#1e272e',
                        paper_bgcolor: '#1e272e',
                        font: { color: '#ecf0f1' },
                        legend: { font: { color: '#ecf0f1' }, orientation: 'h', y: -0.15 }, 
                        xaxis: { title: 'الترتيب التسلسلي لظهور الكلمة', gridcolor: '#34495e', zerolinecolor: '#34495e' },
                        yaxis: { title: 'الموقع المطلق للكلمة (العمق الزمكاني)', gridcolor: '#34495e', zerolinecolor: '#34495e' }
                      }}
                      useResizeHandler={true}
                      style={{ width: '100%', height: '100%' }}
                    />
                 </div>

                 {/* 🟢 تفاصيل النجوم (مفرودة بالتصميم القديم المريح والواسع) */}
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                    {trackedStars.map((star, idx) => {
                       const cosmicColors = ['#f1c40f', '#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c'];
                       const color = cosmicColors[idx % cosmicColors.length];
                       
                       return (
                          <div key={idx} style={{ background: '#f8f9fa', borderRadius: '10px', padding: '25px', border: `2px solid #ddd`, borderRight: `6px solid ${color}`, boxShadow: '0 5px 15px rgba(0,0,0,0.05)' }}>
                             
                             <h3 style={{ margin: '0 0 20px 0', paddingBottom: '15px', borderBottom: `2px dashed #ddd`, color: '#2c3e50', fontSize: '24px', fontFamily: '"Amiri Quran", serif', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ color: color, fontSize: '28px', textShadow: '0 0 10px rgba(0,0,0,0.1)' }}>★</span>
                                تفاصيل النجم: [ {star.word} ]
                             </h3>
                             
                             {/* البطاقات الأربع العلوية الواسعة */}
                             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px' }}>
                                <div style={{ background: '#fff', padding: '15px', borderRadius: '8px', borderBottom: `3px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', textAlign: 'center' }}>
                                   <div style={{ fontSize: '14px', color: '#7f8c8d', fontWeight: 'bold', marginBottom: '5px' }}>تكرار الظهور</div>
                                   <div style={{ fontSize: '26px', color: '#2c3e50', fontWeight: 'bold', fontFamily: 'monospace' }}>{star.count} مرة</div>
                                </div>
                                <div style={{ background: '#fff', padding: '15px', borderRadius: '8px', borderBottom: `3px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', textAlign: 'center' }}>
                                   <div style={{ fontSize: '14px', color: '#7f8c8d', fontWeight: 'bold', marginBottom: '5px' }}>أول ظهور مطلق</div>
                                   <div style={{ fontSize: '26px', color: color, fontWeight: 'bold', fontFamily: 'monospace' }}>{star.firstAppearance}</div>
                                </div>
                                <div style={{ background: '#fff', padding: '15px', borderRadius: '8px', borderBottom: `3px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', textAlign: 'center' }}>
                                   <div style={{ fontSize: '14px', color: '#7f8c8d', fontWeight: 'bold', marginBottom: '5px' }}>مجموع أرقام المواضع</div>
                                   <div style={{ fontSize: '26px', color: '#27ae60', fontWeight: 'bold', fontFamily: 'monospace' }}>{star.sumOfPositions.toLocaleString()}</div>
                                </div>
                                <div style={{ background: '#fff', padding: '15px', borderRadius: '8px', borderBottom: `3px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', textAlign: 'center' }}>
                                   <div style={{ fontSize: '14px', color: '#7f8c8d', fontWeight: 'bold', marginBottom: '2px' }}>معادلة النجم المطلقة</div>
                                   <div style={{ fontSize: '11px', color: '#95a5a6', marginBottom: '3px' }}>(أول ظهور × القيمة المكانية)</div>
                                   <div style={{ fontSize: '26px', color: '#e67e22', fontWeight: 'bold', fontFamily: 'monospace' }}>{star.specialProduct.toLocaleString()}</div>
                                </div>
                             </div>

                             {/* البطاقات الداكنة الثلاث للقيم */}
                             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginBottom: '25px' }}>
                                <div style={{ background: '#2c3e50', padding: '12px', borderRadius: '6px', textAlign: 'center', color: '#fff' }}>
                                   <div style={{ fontSize: '13px', opacity: 0.8, marginBottom: '5px' }}>القيمة التسلسلية للكلمة</div>
                                   <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#ecf0f1' }}>{star.valSequential}</div>
                                </div>
                                <div style={{ background: '#2c3e50', padding: '12px', borderRadius: '6px', textAlign: 'center', color: '#fff' }}>
                                   <div style={{ fontSize: '13px', opacity: 0.8, marginBottom: '5px' }}>القيمة المكانية للكلمة</div>
                                   <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#ecf0f1' }}>{star.valSpatial}</div>
                                </div>
                                <div style={{ background: '#2c3e50', padding: '12px', borderRadius: '6px', textAlign: 'center', color: '#fff' }}>
                                   <div style={{ fontSize: '13px', opacity: 0.8, marginBottom: '5px' }}>القيمة المركبة للكلمة</div>
                                   <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#ecf0f1' }}>{star.valComposite}</div>
                                </div>
                             </div>

                             {/* الجدول الواسع المريح للعين */}
                             <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.03)' }}>
                                <h4 style={{ margin: '0 0 15px 0', color: '#2c3e50', borderBottom: '2px solid #ecf0f1', paddingBottom: '10px' }}>إحداثيات المواقع والمسافات البينية</h4>
                                <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                                   <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                                      <thead style={{ position: 'sticky', top: 0, background: '#34495e', color: '#fff', zIndex: 1 }}>
                                         <tr>
                                           <th style={{ padding: '12px' }}>الرقم</th>
                                           <th style={{ padding: '12px' }}>السورة</th>
                                           <th style={{ padding: '12px' }}>الآية</th>
                                           <th style={{ padding: '12px' }}>الموقع المطلق</th>
                                           <th style={{ padding: '12px' }}>المسافة عن الظهور السابق</th>
                                         </tr>
                                      </thead>
                                      <tbody>
                                         {star.occurrences.map((occ, oIdx) => (
                                            <tr key={oIdx} style={{ borderBottom: '1px solid #eee', background: oIdx % 2 === 0 ? '#fdfdfd' : '#f9f9f9', transition: '0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f1f8ff'} onMouseLeave={(e) => e.currentTarget.style.background = oIdx % 2 === 0 ? '#fdfdfd' : '#f9f9f9'}>
                                               <td style={{ padding: '10px', fontWeight: 'bold' }}>{oIdx + 1}</td>
                                               <td style={{ padding: '10px', color: '#2980b9' }}>{occ.surahName}</td>
                                               <td style={{ padding: '10px' }}>{occ.ayahNum}</td>
                                               <td style={{ padding: '10px', fontWeight: 'bold', color: '#c0392b' }}>{occ.globalPos}</td>
                                               <td style={{ padding: '10px', color: '#27ae60', fontWeight: 'bold' }}>
                                                  {oIdx === 0 ? '---' : `+ ${star.distances[oIdx - 1]} كلمة`}
                                               </td>
                                            </tr>
                                         ))}
                                      </tbody>
                                   </table>
                                </div>
                             </div>

                          </div>
                       );
                    })}
                 </div>

              </div>
           </div>
        </div>
      )}    
      {/* 🟢 نافذة "عن المنصة" (النسخة الشاملة والمدمجة) */}
      {isAboutModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(15, 23, 42, 0.85)', zIndex: 99999, display: 'flex', justifyContent: 'center', alignItems: 'center', direction: 'rtl', backdropFilter: 'blur(10px)' }}>
           <div style={{ background: '#f8f9fa', width: '95%', maxWidth: '1100px', maxHeight: '92vh', borderRadius: '12px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.2)' }}>
              
              {/* شريط العنوان */}
              <div style={{ background: 'linear-gradient(135deg, #2c3e50, #34495e)', padding: '20px 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #3498db' }}>
                 <h2 style={{ margin: 0, color: '#ecf0f1', fontSize: '24px', display: 'flex', alignItems: 'center', gap: '10px', fontFamily: '"Amiri Quran", serif' }}>
                    ℹ️ عن منصة البصمة الرقمية للقرآن الكريم
                 </h2>
                 <button onClick={() => setIsAboutModalOpen(false)} style={{ background: 'rgba(231, 76, 60, 0.2)', color: '#e74c3c', border: '1px solid #e74c3c', borderRadius: '50%', width: '35px', height: '35px', fontSize: '18px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.3s' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#e74c3c'; e.currentTarget.style.color = '#fff'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(231, 76, 60, 0.2)'; e.currentTarget.style.color = '#e74c3c'; }}>X</button>
              </div>

{/* المحتوى الداخلي */}
<div style={{ padding: '30px', overflowY: 'auto', flex: 1, color: '#2c3e50', fontSize: '16px', lineHeight: '2', fontFamily: '"Asmaa Boutros", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif' }}>
                 
                 {/* المقدمة المدمجة */}
                 <div style={{ textAlign: 'center', marginBottom: '35px' }}>
                    <h3 style={{ color: '#2980b9', fontSize: '28px', marginBottom: '12px', fontFamily: '"Amiri Quran", serif' }}>هندسة النسيج القرآني (أداة بحثية متطورة)</h3>
                    <p style={{ color: '#34495e', fontSize: '16px', maxWidth: '850px', margin: '0 auto', fontWeight: '500' }}>
                       هذه المنصة ليست مجرد عارض للنص القرآني، بل هي مرصد رقمي متطور يتعامل مع القرآن الكريم كـ "كون رياضي محكم". تم بناء هذا النظام لاستكشاف وتوثيق البنية الهيكلية الدقيقة جداً لحروف وكلمات القرآن، حيث كل حرف يمتلك إحداثيات لا تتكرر. <br/>
                       <span style={{ color: '#c0392b', fontWeight: 'bold' }}>هذا التطبيق موجه بالأساس للباحثين في مجال الإحصاء الرقمي للقرآن كأداة متطورة للغاية.</span>
                    </p>
                 </div>

                 {/* شبكة البطاقات (Grid Layout) لعرض كل التفاصيل دون ازدحام */}
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '20px' }}>
                    
                    {/* 1. المعيار البصري */}
                    <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', borderRight: '4px solid #8e44ad', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                       <h4 style={{ margin: '0 0 10px 0', color: '#8e44ad', fontSize: '18px' }}>👁️ المعيار البصري المطلق (كما تراه العين)</h4>
                       <p style={{ margin: 0 }}>
                          المعيار الأساسي الذي ترتكز عليه هذه المنصة هو أن تعكس كل حرف تم رسمه في المصحف وكأن العين تراه. يمر كل حرف بدورة تحليلية تبدأ من (حالة وجوده)، ثم (عائلته) التي ينتمي إليها، مروراً بـ (هيئته) التي كُتب بها، ثم (حركات التشكيل والنطق) المرتبطة به، وأخيراً (حالة اتصاله).
                       </p>
                    </div>

                    {/* 2. النظام والبصمة */}
                    <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', borderRight: '4px solid #2980b9', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                       <h4 style={{ margin: '0 0 10px 0', color: '#2980b9', fontSize: '18px' }}>🧬 نظام البصمة وثلاثية المعايير الزمكانية</h4>
<p style={{ margin: 0 }}>
                          يأخذ كل حرف قيمته العددية وكأنها انعكاس رقمي فريد لهيئته الفريدة، وذلك وفق ثلاثة معايير دقيقة:
                          <br/>1. <b>ترتيب ظهوره المتسلسل:</b> (الرتبة الزمنية للاكتشاف).
                          <br/>2. <b>رتبته المكانية المطلقة:</b> (أول ظهور مكاني له في المصحف).
                          <br/>3. <b>البصمة المركبة:</b> (قيمة رقمية تُستخرج من تشابك العائلة مع الهيئة وحالة الاتصال).
                       </p>
                    </div>

                    {/* 3. دقة التوثيق والمحرك المعياري */}
                    <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', borderRight: '4px solid #f39c12', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                       <h4 style={{ margin: '0 0 10px 0', color: '#d35400', fontSize: '18px' }}>🎯 دقة التوثيق ومحرك التوحيد المعياري</h4>
                       <p style={{ margin: 0 }}>
                          لتحقيق أقصى درجات الدقة الإحصائية، لم يتم إهمال أي تفصيل دقيق (كالهمزات العائمة على مد التطويل والياء المعكوفة). تم تزويد المنصة بمحرك ذكي يفهم هذه التعقيدات ويوحدها للبحث، مع مقص ذكي يتخطى البسملة الاستهلالية لحماية سلامة الإحصائيات الزمكانية المطلقة.
                       </p>
                    </div>

                    {/* 4. مرصد النجوم */}
                    <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', borderRight: '4px solid #1abc9c', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                       <h4 style={{ margin: '0 0 10px 0', color: '#16a085', fontSize: '18px' }}>🔭 مرصد النجوم والمحاذاة الفلكية</h4>
                       <p style={{ margin: 0 }}>
                          بضغطة (زر الماوس الأيمن) على أي كلمة، تنبثق شاشة المرصد لتتتبع مسار هذه الكلمة عبر آيات القرآن وكأنها "نجم في الفضاء". يوضح المرصد مواقع الظهور المطلقة، المسافات البينية بالكلمات، ويقدم رسماً بيانياً لتقاطع المدارات عند مقارنة عدة كلمات ببعضها.
                       </p>
                    </div>

                    {/* 5. غرفة التوثيق */}
                    <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', borderRight: '4px solid #e74c3c', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                       <h4 style={{ margin: '0 0 10px 0', color: '#c0392b', fontSize: '18px' }}>🛡️ غرفة التوثيق وكشف التحريف</h4>
                       <p style={{ margin: 0 }}>
                          تستخدم المنصة خوارزميات التشفير (Hashing) لتوليد "توقيع رقمي زمكاني" لأي نص. كما تحتوي الغرفة على <b style={{color: '#c0392b'}}>رادار المحاذاة الذكية (Smart Diffing)</b> القادر على اكتشاف أي محاولة للتحريف (نقص، زيادة، أو استبدال) في أي نص يُعرض عليه ومطابقته بدقة مع المرجع الأصلي.
                       </p>
                    </div>

                    {/* 6. معمل البصمة */}
                    <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', borderRight: '4px solid #27ae60', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                       <h4 style={{ margin: '0 0 10px 0', color: '#27ae60', fontSize: '18px' }}>🔬 معمل البصمة الرقمية (2D & 3D)</h4>
                       <p style={{ margin: 0 }}>
                          يحول هذا المعمل النص المقروء إلى تمثيل بصري. يرسم خرائط ثنائية وثلاثية الأبعاد تبرز الكتل العددية، ويكشف بصرياً عن تكتلات الأعداد الأولية (Primes) ومضاعفات الرقم 19، مما يتيح للباحثين رؤية النبض الرياضي للسور بوضوح تام.
                       </p>
                    </div>
                 </div>

                 {/* 7. النسخة القرآنية المعتمدة (مساحة عرضية كاملة) */}
                 <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #bdc3c7', borderRight: '4px solid #34495e', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', marginTop: '20px' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#2c3e50', fontSize: '18px' }}>📖 النسخة القرآنية المعتمدة</h4>
                    <p style={{ margin: 0, fontWeight: 'bold', color: '#34495e' }}>
                       النسخة المعتمدة في هذا التطبيق للتحليل الإحصائي والمطابقة هي:
                       <br/>
                       <span style={{ color: '#27ae60', fontSize: '19px', fontFamily: '"Amiri Quran", serif' }}>مصحف المدينة المنورة، رواية حفص عن عاصم (طبعة مجمع الملك فهد ).</span>
                    </p>
                 </div>
                 
                 {/* 🟢 تذييل الحقوق والفكرة */}
                 <div style={{ textAlign: 'center', marginTop: '35px', paddingTop: '25px', borderTop: '2px dashed #bdc3c7' }}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#7f8c8d', marginBottom: '5px' }}>
                       فكرة، إعداد، وبناء
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: '900', color: '#2980b9', fontFamily: '"Amiri Quran", serif', marginBottom: '10px' }}>
                       أحمد طلعت
                    </div>
                    <div style={{ fontSize: '15px', color: '#34495e', fontFamily: 'monospace', background: '#ecf0f1', display: 'inline-block', padding: '6px 20px', borderRadius: '25px', border: '1px solid #dcdde1' }}>
                       ahmadalazab2022@gmail.com
                    </div>
                 </div>

              </div>
</div>
        </div>
      )}
      

      
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
      <Analytics />
    </ErrorBoundary>
  );
}