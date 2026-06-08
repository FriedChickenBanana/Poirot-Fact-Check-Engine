export const I18N = {
  en: {
    title: 'Poirot : Fact Checking Engine',
    subtitle: 'Live demo · Black/White Protocol',
    consoleTitle: 'Verification Console',
    consoleStatus: 'Active',
    enterClaimOrImage: 'Enter a claim, URL, or upload an image',
    placeholderClaim: 'Verify a claim or paste a URL...',
    uploadImage: 'Upload Image',
    submit: 'Verify',
    analyzing: 'Analyzing...',
    verdict: 'Verdict',
    confidence: 'Confidence',
    keyFindings: 'Key Findings',
    sources: 'Sources',
    noExplanation: 'No explanation provided.',
    noSources: 'No sources provided.',
    error: 'Error',
    verdictTrue: 'Likely True',
    verdictFalse: 'Likely False',
    verdictUncertain: 'Uncertain',
    verdictSatirical: 'Satirical',
    verdictError: 'Error',
    speak: 'Play verdict',
    language: 'Language',
    languageAuto: 'Auto',
    languageEnglish: 'English',
    languageBangla: 'Bangla',
    lowBandwidth: 'Low-bandwidth mode',
    extractingContent: 'Extracting content from link...',
    socialMediaExtracted: 'Text extracted from social media',
    failedToExtract: 'Could not extract content from this link',
    linkVerification: 'Link Verification',
    trustScore: 'Trust Score'
  },
  bn: {
    title: 'Poirot : তথ্য যাচাই ইঞ্জিন',
    subtitle: 'লাইভ ডেমো · ব্ল্যাক/হোয়াইট প্রোটোকল',
    consoleTitle: 'যাচাই কনসোল',
    consoleStatus: 'সক্রিয়',
    enterClaimOrImage: 'একটি দাবি, URL বা ছবি আপলোড করুন',
    placeholderClaim: 'একটি দাবি যাচাই করুন বা URL পেস্ট করুন...',
    uploadImage: 'ছবি আপলোড করুন',
    submit: 'যাচাই করুন',
    analyzing: 'বিশ্লেষণ করা হচ্ছে...',
    verdict: 'সিদ্ধান্ত',
    confidence: 'আত্মবিশ্বাস',
    keyFindings: 'মূল তথ্য',
    sources: 'উৎস',
    noExplanation: 'কোনো ব্যাখ্যা প্রদান করা হয়নি।',
    noSources: 'কোনো উৎস প্রদান করা হয়নি।',
    error: 'ত্রুটি',
    verdictTrue: 'সম্ভবত সত্য',
    verdictFalse: 'সম্ভবত মিথ্যা',
    verdictUncertain: 'অনিশ্চিত',
    verdictSatirical: 'ব্যঙ্গাত্মক',
    verdictError: 'ত্রুটি',
    speak: 'সিদ্ধান্ত শুনুন',
    language: 'ভাষা',
    languageAuto: 'স্বয়ংক্রিয়',
    languageEnglish: 'ইংরেজি',
    languageBangla: 'বাংলা',
    lowBandwidth: 'লো-ব্যান্ডউইথ মোড',
    extractingContent: 'লিংক থেকে কনটেন্ট বের করা হচ্ছে...',
    socialMediaExtracted: 'সোশ্যাল মিডিয়া থেকে পাঠ্য বের করা হয়েছে',
    failedToExtract: 'এই লিংক থেকে কনটেন্ট বের করা যায়নি',
    linkVerification: 'লিংক যাচাই',
    trustScore: 'বিশ্বাসযোগ্যতা'
  }
};

export const VOICE_PHRASES = {
  en: {
    true: 'The news is true.',
    false: 'The news is not true.',
    uncertain: 'The news is uncertain.',
    satirical: 'The news is satirical.',
    error: 'Unable to determine the result.'
  },
  bn: {
    true: 'খবরটি সত্য।',
    false: 'খবরটি সত্য নয়।',
    uncertain: 'খবরটি অনিশ্চিত।',
    satirical: 'খবরটি ব্যঙ্গাত্মক।',
    error: 'ফলাফল নির্ধারণ করা যায়নি।'
  }
};

export function t(language, key) {
  const dict = I18N[language] || I18N.en;
  return dict[key] || I18N.en[key] || '';
}

export function getVoicePhrase(language, verdictCode) {
  const phrases = VOICE_PHRASES[language] || VOICE_PHRASES.en;
  return phrases[verdictCode] || phrases.uncertain;
}

export function normalizeVerdictCode(verdict) {
  const value = (verdict || '').toLowerCase();
  if (value.includes('satir') || value.includes('ব্যঙ্গ')) return 'satirical';
  if (value.includes('false') || value.includes('মিথ্যা')) return 'false';
  if (value.includes('true') || value.includes('সত্য')) return 'true';
  if (value.includes('error') || value.includes('ত্রুটি')) return 'error';
  if (value.includes('uncertain') || value.includes('অনিশ্চিত')) return 'uncertain';
  return 'uncertain';
}

export function speakVerdict(language, verdictCode) {
  if (!window.speechSynthesis) return;
  const phrase = getVoicePhrase(language, verdictCode);
  if (!phrase) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(phrase);
  utterance.lang = language === 'bn' ? 'bn-BD' : 'en-US';
  const voices = window.speechSynthesis.getVoices();
  const voice = language === 'bn'
    ? voices.find(v => v.lang && v.lang.toLowerCase().startsWith('bn'))
    : voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export function isSocialMediaLink(text) {
  const socialRegex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|linkedin\.com|reddit\.com|threads\.net)\//i;
  return socialRegex.test(text);
}

export function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}
