/**
 * SAFAR i18n.js — Three-language engine (English / Hindi / Sanskrit)
 * + Bhagavad Gita rotating quote bar + full shloka modal
 */

/* ─────────────────────── TRANSLATIONS ─────────────────────── */
const TRANSLATIONS = {
  en: {
    // Navbar
    'nav.home': 'Home', 'nav.groups': 'Groups', 'nav.identity': 'Identity Ledger',
    'nav.ai': 'AI Assistant', 'nav.about': 'About', 'nav.safety': '🛡️ Safety',
    'nav.logout': 'Logout', 'nav.login': 'Login', 'nav.getstarted': 'Get Started',
    // Hero
    'hero.tag': '✈️ India\'s Smartest Travel Platform',
    'hero.h1a': 'Travel Smart.', 'hero.h1b': 'Travel Safe.', 'hero.h1c': 'Travel Together.',
    'hero.desc': 'SAFAR combines AI-powered group travel with real-time tourist safety — discover destinations, build your travel squad, and explore India with confidence.',
    'hero.stat.travelers': 'Travelers', 'hero.stat.groups': 'Groups', 'hero.stat.zones': 'Safety Zones',
    // Search Widget
    'sw.tab.groups': 'Groups', 'sw.tab.destinations': 'Destinations', 'sw.tab.safety': 'Safety',
    'sw.label.heading': 'Where are you heading?', 'sw.placeholder.dest': 'e.g. Manali, Goa, Jaipur...',
    'sw.label.grouptype': 'Group Type', 'sw.opt.alltypes': 'All Types', 'sw.opt.public': 'Public', 'sw.opt.private': 'Private',
    'sw.label.members': 'Members', 'sw.opt.anysize': 'Any Size',
    'sw.btn.findgroups': 'Find Travel Groups',
    'sw.label.explore': 'Explore Destinations', 'sw.placeholder.search': 'Search cities, landmarks, states...',
    'sw.btn.browse': 'Browse Destinations',
    'sw.label.safety': 'Check Safety Score', 'sw.placeholder.location': 'Enter your current location...',
    'sw.safety.zones': '17 monitored safety zones across India',
    'sw.safety.gps': 'Real-time GPS tracking & anomaly detection',
    'sw.safety.sos': 'One-tap panic button with instant alerts',
    'sw.btn.dashboard': 'Open Safety Dashboard',
    // Sections
    'dest.tag': 'Explore India', 'dest.h2': 'Popular Destinations',
    'dest.sub': 'Join travel squads headed to India\'s most loved destinations', 'dest.explore': 'Explore Groups →',
    'feat.tag': 'The SAFAR Advantage', 'feat.h2': 'Everything You Need for Smart Travel',
    'feat.sub': 'One platform. Group planning. AI safety. Real-time tracking.',
    'feat.squads.title': 'Travel Squads', 'feat.squads.desc': 'Create or join travel groups, plan destinations together, and stay connected with real-time group chat.',
    'feat.safety.title': 'Tourist Safety', 'feat.safety.desc': 'Real-time GPS tracking, geo-fenced safety zones, anomaly detection, and a one-tap panic button.',
    'feat.ai.title': 'AI Travel Assistant', 'feat.ai.desc': 'Get personalized travel recommendations, safety tips, and destination insights from our AI engine.',
    'feat.geo.title': 'Smart Geo-Fencing', 'feat.geo.desc': 'Automatic safety scoring based on your location, with alerts when entering high-risk zones.',
    'feat.panic.title': 'Panic Button', 'feat.panic.desc': 'One-tap emergency alert that instantly notifies authorities with your real-time location.',
    'feat.chat.title': 'Real-Time Chat', 'feat.chat.desc': 'Stay in touch with your travel squad through socket-powered instant messaging.',
    // Animals
    'animals.tag': '🇮🇳 Pride of India', 'animals.h2': 'Guardians of the Journey',
    'animals.sub': 'Three SAFAR systems secure identity, movement, and assistance across every journey.',
    'animal.airavat.name': 'Airavat', 'animal.airavat.role': 'Blockchain Security System', 'animal.airavat.desc': 'Protects verified identities, permits, and travel records on an immutable trust layer.',
    'animal.garuda.name': 'Garuda', 'animal.garuda.role': 'Tracking and Response System', 'animal.garuda.desc': 'Monitors live GPS, triggers SOS flows, enforces geo-fences, and flags anomalies in real time.',
    'animal.mayurya.name': 'Mayurya', 'animal.mayurya.role': 'SAFAR AI Assistant', 'animal.mayurya.desc': 'Acts as SAFAR\'s own AI copilot for guidance, recommendations, and proactive travel support.',
    // Offers
    'offers.tag': 'Why SAFAR', 'offers.h2': 'Built for Travelers, Backed by AI',
    'offer.free.title': '100% Free Platform', 'offer.free.desc': 'No subscriptions, no hidden fees. Travel together without spending a rupee on the app.',
    'offer.ai.title': 'AI-Powered Intelligence', 'offer.ai.desc': 'Our anomaly detection system monitors travel patterns and flags unusual activity in real time.',
    'offer.kyc.title': 'Verified Travelers', 'offer.kyc.desc': 'Every tourist is KYC-verified with Aadhaar/Passport for a safe and trusted travel community.',
    'offer.live.title': 'Real-Time Everything', 'offer.live.desc': 'Live GPS, live chat, live safety scores — every feature updates instantly.',
    // CTA
    'cta.h2': 'Ready for Your Next Adventure?',
    'cta.sub': 'Join thousands of travelers who explore India smartly and safely with SAFAR.',
    'cta.btn.start': 'Start Your Journey — Free', 'cta.btn.ai': '🤖 Talk to AI Assistant',
    // Footer
    'footer.tagline': "India's first AI-powered group travel platform with real-time tourist safety. Plan smart, travel safe.",
    'footer.quicklinks': 'Quick Links', 'footer.safety': 'Safety', 'footer.resources': 'Resources',
    'footer.copy': '© SAFAR — Built with ❤️ by Team Safar',
    // Chatbot
    'chatbot.greeting': '✈️ Hi! I\'m your SAFAR AI assistant. How can I help you plan your next trip?',
    'chatbot.placeholder': 'Ask me anything about travel...',
    // Nav safety
    'nav.safety': '🛡️ Safety',
  },
  hi: {
    // Navbar
    'nav.home': 'होम', 'nav.groups': 'समूह', 'nav.identity': 'पहचान खाता-बही',
    'nav.ai': 'AI सहायक', 'nav.about': 'हमारे बारे में', 'nav.safety': '🛡️ सुरक्षा',
    'nav.logout': 'लॉग आउट', 'nav.login': 'लॉगिन', 'nav.getstarted': 'शुरू करें',
    // Hero
    'hero.tag': '✈️ भारत का सबसे स्मार्ट यात्रा मंच',
    'hero.h1a': 'स्मार्ट यात्रा करें।', 'hero.h1b': 'सुरक्षित यात्रा करें।', 'hero.h1c': 'एक साथ यात्रा करें।',
    'hero.desc': 'SAFAR AI-संचालित समूह यात्रा को वास्तविक समय पर्यटक सुरक्षा के साथ जोड़ता है — गंतव्य खोजें, अपना यात्रा दल बनाएं और आत्मविश्वास के साथ भारत का अन्वेषण करें।',
    'hero.stat.travelers': 'यात्री', 'hero.stat.groups': 'समूह', 'hero.stat.zones': 'सुरक्षा क्षेत्र',
    // Search Widget
    'sw.tab.groups': 'समूह', 'sw.tab.destinations': 'गंतव्य', 'sw.tab.safety': 'सुरक्षा',
    'sw.label.heading': 'आप कहाँ जा रहे हैं?', 'sw.placeholder.dest': 'जैसे मनाली, गोवा, जयपुर...',
    'sw.label.grouptype': 'समूह प्रकार', 'sw.opt.alltypes': 'सभी प्रकार', 'sw.opt.public': 'सार्वजनिक', 'sw.opt.private': 'निजी',
    'sw.label.members': 'सदस्य', 'sw.opt.anysize': 'कोई भी आकार',
    'sw.btn.findgroups': 'यात्रा समूह खोजें',
    'sw.label.explore': 'गंतव्य खोजें', 'sw.placeholder.search': 'शहर, स्थल, राज्य खोजें...',
    'sw.btn.browse': 'गंतव्य देखें',
    'sw.label.safety': 'सुरक्षा स्कोर जांचें', 'sw.placeholder.location': 'अपनी वर्तमान स्थिति दर्ज करें...',
    'sw.safety.zones': '17 निगरानी सुरक्षा क्षेत्र पूरे भारत में',
    'sw.safety.gps': 'वास्तविक समय GPS ट्रैकिंग और विसंगति पहचान',
    'sw.safety.sos': 'एक-टैप पैनिक बटन तत्काल अलर्ट के साथ',
    'sw.btn.dashboard': 'सुरक्षा डैशबोर्ड खोलें',
    // Sections
    'dest.tag': 'भारत का अन्वेषण', 'dest.h2': 'लोकप्रिय गंतव्य',
    'dest.sub': 'भारत के सबसे प्रिय गंतव्यों की ओर यात्रा दलों से जुड़ें', 'dest.explore': 'समूह देखें →',
    'feat.tag': 'SAFAR का लाभ', 'feat.h2': 'स्मार्ट यात्रा के लिए सब कुछ',
    'feat.sub': 'एक मंच। समूह योजना। AI सुरक्षा। वास्तविक समय ट्रैकिंग।',
    'feat.squads.title': 'यात्रा दल', 'feat.squads.desc': 'यात्रा समूह बनाएं या जुड़ें, गंतव्य एक साथ योजना बनाएं।',
    'feat.safety.title': 'पर्यटक सुरक्षा', 'feat.safety.desc': 'वास्तविक समय GPS, भू-बाड़ा सुरक्षा क्षेत्र और पैनिक बटन।',
    'feat.ai.title': 'AI यात्रा सहायक', 'feat.ai.desc': 'व्यक्तिगत यात्रा अनुशंसाएं और सुरक्षा सुझाव पाएं।',
    'feat.geo.title': 'स्मार्ट जियो-फेंसिंग', 'feat.geo.desc': 'आपकी स्थिति के आधार पर स्वचालित सुरक्षा स्कोरिंग।',
    'feat.panic.title': 'पैनिक बटन', 'feat.panic.desc': 'एक-टैप आपातकालीन अलर्ट जो तुरंत अधिकारियों को सूचित करता है।',
    'feat.chat.title': 'वास्तविक समय चैट', 'feat.chat.desc': 'सॉकेट-संचालित त्वरित संदेश के माध्यम से जुड़े रहें।',
    // Animals
    'animals.tag': '🇮🇳 भारत का गौरव', 'animals.h2': 'यात्रा के संरक्षक',
    'animals.sub': 'SAFAR की तीन मुख्य प्रणालियाँ हर यात्रा में पहचान, आवाजाही और सहायता को सुरक्षित रखती हैं।',
    'animal.airavat.name': 'ऐरावत', 'animal.airavat.role': 'ब्लॉकचेन सुरक्षा प्रणाली', 'animal.airavat.desc': 'सत्यापित पहचान, परमिट और यात्रा रिकॉर्ड को अपरिवर्तनीय भरोसेमंद परत पर सुरक्षित रखती है।',
    'animal.garuda.name': 'गरुड़', 'animal.garuda.role': 'ट्रैकिंग और रेस्पॉन्स प्रणाली', 'animal.garuda.desc': 'लाइव GPS की निगरानी करती है, SOS शुरू करती है, geo-fence लागू करती है और रियल टाइम में अनियमितताओं को चिन्हित करती है।',
    'animal.mayurya.name': 'मयूर्या', 'animal.mayurya.role': 'SAFAR एआई सहायक', 'animal.mayurya.desc': 'मार्गदर्शन, सुझाव और सक्रिय यात्रा सहायता के लिए SAFAR का अपना AI सह-पायलट है।',
    // Offers
    'offers.tag': 'SAFAR क्यों', 'offers.h2': 'यात्रियों के लिए निर्मित, AI द्वारा समर्थित',
    'offer.free.title': '100% निःशुल्क मंच', 'offer.free.desc': 'कोई सदस्यता नहीं, कोई छिपी फीस नहीं।',
    'offer.ai.title': 'AI-संचालित बुद्धिमत्ता', 'offer.ai.desc': 'हमारी विसंगति पहचान प्रणाली यात्रा पैटर्न की निगरानी करती है।',
    'offer.kyc.title': 'सत्यापित यात्री', 'offer.kyc.desc': 'हर पर्यटक आधार/पासपोर्ट से KYC-सत्यापित है।',
    'offer.live.title': 'वास्तविक समय सब कुछ', 'offer.live.desc': 'लाइव GPS, लाइव चैट, लाइव सुरक्षा स्कोर।',
    // CTA
    'cta.h2': 'अगले रोमांच के लिए तैयार हैं?',
    'cta.sub': 'हजारों यात्रियों से जुड़ें जो SAFAR के साथ भारत का स्मार्ट और सुरक्षित अन्वेषण करते हैं।',
    'cta.btn.start': 'अपनी यात्रा शुरू करें — मुफ़्त', 'cta.btn.ai': '🤖 AI सहायक से बात करें',
    // Footer
    'footer.tagline': 'भारत का पहला AI-संचालित समूह यात्रा मंच। स्मार्ट योजना, सुरक्षित यात्रा।',
    'footer.quicklinks': 'त्वरित लिंक', 'footer.safety': 'सुरक्षा', 'footer.resources': 'संसाधन',
    'footer.copy': '© SAFAR — टीम SAFAR द्वारा ❤️ से निर्मित',
    'chatbot.greeting': '✈️ नमस्ते! मैं आपका SAFAR AI सहायक हूं। आपकी यात्रा योजना में कैसे मदद करूं?',
    'chatbot.placeholder': 'यात्रा के बारे में कुछ भी पूछें...',
    'nav.safety': '🛡️ सुरक्षा',
  },
  sa: {
    // Navbar
    'nav.home': 'गृहम्', 'nav.groups': 'समूहाः', 'nav.identity': 'परिचयपत्रम्',
    'nav.ai': 'AI सहायकः', 'nav.about': 'अस्माकं विषये', 'nav.safety': '🛡️ सुरक्षा',
    'nav.logout': 'निर्गमनम्', 'nav.login': 'प्रवेशः', 'nav.getstarted': 'आरभत',
    // Hero
    'hero.tag': '✈️ भारतस्य बुद्धिमान् यात्रामञ्चः',
    'hero.h1a': 'बुद्धिमान् यात्रा।', 'hero.h1b': 'सुरक्षिता यात्रा।', 'hero.h1c': 'सह यात्रा।',
    'hero.desc': 'SAFAR AI-चालितं समूहयात्रां वास्तवकाल-पर्यटकसुरक्षया सह योजयति। भारतम् विश्वासेन परिशोधयन्तु।',
    'hero.stat.travelers': 'यात्रिकाः', 'hero.stat.groups': 'समूहाः', 'hero.stat.zones': 'सुरक्षाक्षेत्राणि',
    // Animals
    'animals.tag': '🇮🇳 भारतस्य गौरवम्', 'animals.h2': 'यात्रायाः रक्षकाः',
    'animals.sub': 'SAFAR इत्यस्य त्रयः मुख्यप्रणाल्यः प्रत्येकयात्रायां परिचयं गमनागमनं साहाय्यं च संरक्षन्ति।',
    'animal.airavat.name': 'ऐरावतः', 'animal.airavat.role': 'ब्लॉकचेन-सुरक्षा-प्रणाली', 'animal.airavat.desc': 'सत्यापित-परिचयान्, अनुमतिपत्राणि, यात्रालेखान् च अपरिवर्तनीय-विश्वास-स्तरे रक्षति।',
    'animal.garuda.name': 'गरुडः', 'animal.garuda.role': 'अनुगमन-प्रत्युत्तर-प्रणाली', 'animal.garuda.desc': 'जीपीएस-स्थानम् अनुगच्छति, एसओएस-संकेतं प्रवर्तयति, भू-सीमाः पालयति, विचलनानि च तत्क्षणं सूचयति।',
    'animal.mayurya.name': 'मयूर्यः', 'animal.mayurya.role': 'SAFAR-एआई-सहायकः', 'animal.mayurya.desc': 'मार्गदर्शनाय, अनुशंसाभ्यः, सक्रिय-यात्रासाहाय्याय च SAFAR इत्यस्य स्वकीयः एआई-सहचरः।',
    // Sections
    'dest.tag': 'भारतम् अन्वेषयन्तु', 'dest.h2': 'लोकप्रियगंतव्यानि', 'dest.sub': 'भारतस्य प्रियगंतव्येषु समूहैः सह यात्रां कुरुत', 'dest.explore': 'समूहाः →',
    'feat.tag': 'SAFAR-लाभः', 'feat.h2': 'बुद्धिमत्याः यात्रायै सर्वम्', 'feat.sub': 'एकं मञ्चम्। समूहयोजना। AI-सुरक्षा।',
    'feat.squads.title': 'यात्रादलानि', 'feat.squads.desc': 'यात्रासमूहान् निर्मान्तु अथवा सम्मिलन्तु।',
    'feat.safety.title': 'पर्यटकसुरक्षा', 'feat.safety.desc': 'वास्तवकाल-GPS, भू-परिरक्षण-क्षेत्राणि च।',
    'feat.ai.title': 'AI-यात्रासहायकः', 'feat.ai.desc': 'व्यक्तिगतयात्रा-परामर्श लभन्तु।',
    'feat.geo.title': 'भू-परिरक्षणम्', 'feat.geo.desc': 'स्वचालित-सुरक्षा-मूल्यांकनम्।',
    'feat.panic.title': 'आपत्कालीन बटन', 'feat.panic.desc': 'एकस्पर्श-आपत्कालीन-संकेतः।',
    'feat.chat.title': 'वास्तवकाल-संवादः', 'feat.chat.desc': 'सॉकेट-चालित-संदेशद्वारा संपर्के तिष्ठन्तु।',
    // Offers
    'offers.tag': 'SAFAR किमर्थम्', 'offers.h2': 'यात्रिकेभ्यः निर्मितम्, AI-समर्थितम्',
    'offer.free.title': 'निःशुल्कं मञ्चम्', 'offer.free.desc': 'कोपि सदस्यता नास्ति।',
    'offer.ai.title': 'AI-बुद्धिमत्ता', 'offer.ai.desc': 'विसंगतिपहचान-प्रणाली यात्राशैलीं निरीक्षति।',
    'offer.kyc.title': 'सत्यापित-यात्रिकाः', 'offer.kyc.desc': 'प्रत्येकः पर्यटकः KYC-सत्यापितः।',
    'offer.live.title': 'वास्तवकाल-सर्वम्', 'offer.live.desc': 'जीवंत-GPS, जीवंत-संवादः।',
    // CTA
    'cta.h2': 'पुनश्च रोमाञ्चकयात्रायै सज्जाः?',
    'cta.sub': 'SAFAR-सह भारतम् बुद्धिमान् सुरक्षितञ्च परिशोधयतां सहस्रैः यात्रिकैः सम्मिलन्तु।',
    'cta.btn.start': 'यात्रामारभत — निःशुल्कम्', 'cta.btn.ai': '🤖 AI-सहायकेन वदन्तु',
    // Footer
    'footer.tagline': 'भारतस्य प्रथमं AI-चालितं समूहयात्रा-मञ्चम्।',
    'footer.quicklinks': 'त्वरित-लिंकाः', 'footer.safety': 'सुरक्षा', 'footer.resources': 'संसाधनानि',
    'footer.copy': '© SAFAR — दलेन SAFAR निर्मितम्',
    'chatbot.greeting': '✈️ नमस्ते! अहं भवतां SAFAR-AI-सहायकः अस्मि। यात्राविषये किं जानितुमिच्छन्ति?',
    'chatbot.placeholder': 'यात्राविषये किमपि पृच्छन्तु...',
    'nav.safety': '🛡️ सुरक्षा',
  }
};

/* ─────────────────────── BHAGAVAD GITA QUOTES ─────────────────────── */
const GITA_QUOTES = [
  {
    sa:  'कर्मण्येवाधिकारस्ते\nमा फलेषु कदाचन।\nमा कर्मफलहेतुर्भूर्\nमा ते सङ्गोऽस्त्वकर्मणि॥',
    hi:  'तुम्हारा कर्म करने पर ही अधिकार है, फलों पर नहीं।',
    en:  'You have a right to perform your duties, but the fruits of action are not for you.',
    ref: 'Bhagavad Gita 2.47'
  },
  {
    sa:  'योगस्थः कुरु कर्माणि\nसङ्गं त्यक्त्वा धनञ्जय।\nसिद्ध्यसिद्ध्योः समो भूत्वा\nसमत्वं योग उच्यते॥',
    hi:  'संतुलन को योग कहते हैं। समभाव से कर्म करो।',
    en:  'Perform action, O Arjuna, being steadfast in yoga, abandoning attachment. Equanimity is called yoga.',
    ref: 'Bhagavad Gita 2.48'
  },
  {
    sa:  'नायं आत्मा बलहीनेन\nलभ्यो न च प्रमादतः।\nन बहुना श्रुतेनापि\nमेधया वा विनिश्चितः॥',
    hi:  'आत्मा बलहीन व्यक्ति को नहीं मिलती, न लापरवाह को।',
    en:  'The soul is not to be won by the weakling, nor by the negligent, nor by one without knowledge.',
    ref: 'Mundaka Upanishad 3.2.4'
  },
  {
    sa:  'श्रेयान्स्वधर्मो विगुणः\nपरधर्मात्स्वनुष्ठितात्।\nस्वधर्मे निधनं श्रेयः\nपरधर्मो भयावहः॥',
    hi:  'अपना धर्म, चाहे कमजोर हो, दूसरे के धर्म से श्रेष्ठ है।',
    en:  'Better is one\'s own dharma, imperfectly performed, than the dharma of another well performed.',
    ref: 'Bhagavad Gita 3.35'
  },
  {
    sa:  'यदा यदा हि धर्मस्य\nग्लानिर्भवति भारत।\nअभ्युत्थानमधर्मस्य\nतदात्मानं सृजाम्यहम्॥',
    hi:  'जब-जब धर्म की हानि होती है, मैं अवतरित होता हूँ।',
    en:  'Whenever dharma declines and adharma rises, I manifest myself, O Bharata.',
    ref: 'Bhagavad Gita 4.7'
  },
  {
    sa:  'सर्वधर्मान्परित्यज्य\nमामेकं शरणं व्रज।\nअहं त्वां सर्वपापेभ्यो\nमोक्षयिष्यामि मा शुचः॥',
    hi:  'सब धर्मों को त्यागकर मेरी शरण में आओ। मैं सब पापों से मुक्त करूंगा।',
    en:  'Abandon all duties and take refuge in me alone. I shall deliver you from all sins.',
    ref: 'Bhagavad Gita 18.66'
  },
  {
    sa:  'नास्ति बुद्धिरयुक्तस्य\nन चायुक्तस्य भावना।\nन चाभावयतः शान्तिः\nअशान्तस्य कुतः सुखम्॥',
    hi:  'बिना नियंत्रित मन के बुद्धि नहीं, बिना शांति के सुख नहीं।',
    en:  'There is no knowledge to the undisciplined, no meditation to the undisciplined, no peace — whence happiness?',
    ref: 'Bhagavad Gita 2.66'
  },
  {
    sa:  'उद्धरेदात्मनात्मानं\nनात्मानमवसादयेत्।\nआत्मैव ह्यात्मनो बन्धुः\nआत्मैव रिपुरात्मन:॥',
    hi:  'अपने आप को ऊपर उठाओ, नीचे मत गिराओ। तुम्हीं अपने मित्र और शत्रु हो।',
    en:  'Elevate yourself through the power of your mind, do not debase yourself. The mind can be your friend or enemy.',
    ref: 'Bhagavad Gita 6.5'
  }
];

/* ─────────────────────── STATE ─────────────────────── */
let currentLang   = localStorage.getItem('safar_lang') || 'en';
let currentQuote  = 0;
let quoteInterval = null;

/* ─────────────────────── APPLY TRANSLATIONS ─────────────────────── */
function applyTranslations(lang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  // data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (dict[key]) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = dict[key];
      } else {
        el.textContent = dict[key];
      }
    }
  });
  // data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (dict[key]) el.placeholder = dict[key];
  });
  // Set html lang attribute
  document.documentElement.lang = lang === 'sa' ? 'sa' : lang === 'hi' ? 'hi' : 'en';
  document.body.dataset.lang = lang;
}

/* ─────────────────────── LANGUAGE TOGGLE ─────────────────────── */
const LANG_CYCLE = ['en', 'hi', 'sa'];
const LANG_META  = {
  en: { label: 'EN', flag: '🇮🇳', name: 'English' },
  hi: { label: 'हि', flag: '🇮🇳', name: 'हिन्दी' },
  sa: { label: 'सं', flag: '🇮🇳', name: 'संस्कृतम्' }
};

function updateToggleBtn() {
  const btns = document.querySelectorAll('#lang-toggle-btn');
  btns.forEach(btn => {
    const flagEl  = btn.querySelector('.lang-flag');
    const labelEl = btn.querySelector('.lang-label');
    if (flagEl)  flagEl.textContent  = LANG_META[currentLang].flag;
    if (labelEl) labelEl.textContent = LANG_META[currentLang].label;
    btn.title = `Switch to ${LANG_META[LANG_CYCLE[(LANG_CYCLE.indexOf(currentLang) + 1) % 3]].name}`;
  });
}

function switchLanguage() {
  const btns = document.querySelectorAll('#lang-toggle-btn');
  btns.forEach(btn => btn.classList.add('switching'));
  setTimeout(() => {
    const idx      = LANG_CYCLE.indexOf(currentLang);
    currentLang    = LANG_CYCLE[(idx + 1) % LANG_CYCLE.length];
    localStorage.setItem('safar_lang', currentLang);
    applyTranslations(currentLang);
    updateToggleBtn();
    renderGitaBar(currentQuote);
    btns.forEach(btn => btn.classList.remove('switching'));
  }, 220);
}

/* ─────────────────────── GITA QUOTE BAR ─────────────────────── */
function renderGitaBar(idx) {
  const q    = GITA_QUOTES[idx];
  const bar  = document.getElementById('gita-quote-bar');
  if (!bar) return;

  const saEl    = bar.querySelector('.gita-sanskrit');
  const transEl = bar.querySelector('.gita-translation');
  const refEl   = bar.querySelector('.gita-ref');

  if (saEl)    saEl.textContent    = q.sa.split('\n')[0] + '...';
  if (transEl) transEl.textContent = currentLang === 'hi' ? q.hi : (currentLang === 'sa' ? q.sa.split('\n')[0] : q.en);
  if (refEl)   refEl.textContent   = q.ref;
}

function cycleGita() {
  const bar = document.getElementById('gita-quote-bar');
  if (bar) bar.classList.add('fading');
  setTimeout(() => {
    currentQuote = (currentQuote + 1) % GITA_QUOTES.length;
    renderGitaBar(currentQuote);
    if (bar) bar.classList.remove('fading');
  }, 400);
}

function initGitaBar() {
  currentQuote = Math.floor(Math.random() * GITA_QUOTES.length);
  renderGitaBar(currentQuote);
  quoteInterval = setInterval(cycleGita, 9000);

  const bar = document.getElementById('gita-quote-bar');
  if (bar) bar.addEventListener('click', openGitaModal);
}

/* ─────────────────────── GITA FULL MODAL ─────────────────────── */
function openGitaModal() {
  const q      = GITA_QUOTES[currentQuote];
  const modal  = document.getElementById('gita-full-modal');
  if (!modal) return;

  const saEl  = modal.querySelector('.gita-modal-sanskrit');
  const hiEl  = modal.querySelector('.gita-modal-hindi');
  const enEl  = modal.querySelector('.gita-modal-english');
  const refEl = modal.querySelector('.gita-modal-ref');

  if (saEl)  saEl.textContent  = q.sa;
  if (hiEl)  hiEl.textContent  = q.hi;
  if (enEl)  enEl.textContent  = '"' + q.en + '"';
  if (refEl) refEl.textContent = '— ' + q.ref;

  modal.classList.add('open');
  clearInterval(quoteInterval);

  const closeBtn = modal.querySelector('.gita-modal-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.classList.remove('open');
      quoteInterval = setInterval(cycleGita, 9000);
    };
  }
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      modal.classList.remove('open');
      quoteInterval = setInterval(cycleGita, 9000);
    }
  }, { once: true });
}

/* ─────────────────────── INIT ─────────────────────── */
function init() {
  // Wire toggle buttons (multiple may exist)
  document.querySelectorAll('#lang-toggle-btn').forEach(btn => {
    btn.addEventListener('click', switchLanguage);
  });

  // Apply saved language
  applyTranslations(currentLang);
  updateToggleBtn();

  // Start Gita bar
  initGitaBar();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
