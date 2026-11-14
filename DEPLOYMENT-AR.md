# دليل تشغيل وبناء ونشر TAREEQ

## ما الذي تحتويه الحزمة؟

تحتوي الحزمة على مصدر المشروع كاملًا، ونسخة إنتاج مبنية مسبقًا، وبيانات ارتفاع MOLA الرقمية المضمّنة، ونموذج Curiosity الرسمي ثلاثي الأبعاد من NASA. يعمل التدفق الرئيسي في المتصفح من دون Backend أو مفتاح API: يبدأ بعرض المريخ ثلاثي الأبعاد، ثم ينتقل إلى الخريطة ثنائية الأبعاد للقياس وتحديد المسار، وبعد اختيار خوارزمية يعرض **منطقة الروت محليًا** في مشهد 3D قريب، مع rover متحرك وخريطة مصغّرة للمسار كاملًا.

**حالة نسخة العرض:** بيانات Jezero المضمّنة تغطي المنطقة الإقليمية فقط: CTX DTM حقيقي بدقة 20 م وصورة grayscale مطابقة بدقة 6 م. قيم CTX/MOLA الأصلية مرجعية إلى الـareoid؛ يحوّل التطبيق ارتفاع العرض إلى Mars ellipsoid باستخدام شبكة MOLA areoid الرسمية المضمّنة. أثناء المهمة الإقليمية يخفي التطبيق صور MOLA/Viking العالمية حتى لا تطغى على صورة CTX، ثم يعيد إعدادات ظهورها عند الخروج. يضيف مشهد المهمة origin محليًا محسوبًا للعرض فقط، ويرفع خط الطريق 20 م فوق سطح العرض؛ كما يعرض الخط من إحداثياته ثلاثية الأبعاد عبر طبقة screen-space لزيادة وضوحه. لا يغيّر ذلك DEM أو كلفة المسار أو الإحداثيات. ويعرض mini-map مخطط ارتفاع من عينات DTM الخام فوق الـareoid مع مؤشر موقع rover الحالي. وخارج التغطية يعود إلى MOLA العالمي الخشن مع تحذير من عدم وجود تفاصيل rover-scale. هذه نسخة وظيفية، وليست بجودة لعبة AAA أو صورة NASA المرجعية. منتجات HiRISE الأعلى دقة موجودة في سجل المصادر على الإنترنت لكنها غير مضمنة في ZIP الحالي.

مشكلة «الفضاء الأسود» لم تكن دليلًا على تلف بطاقة الرسومات. كان بدء mission يعرض لقطة الكرة الافتراضية أولًا، ثم يضع الكاميرا فوق العربة بدل خلفها، وكانت العربة في بعض الحالات رمزًا مسطحًا. الآن تغطي شاشة إعداد قصيرة المشهد حتى تصبح بيانات المنطقة جاهزة، ثم تُوجّه الكاميرا خلف العربة وعلى ارتفاع قريب، ويُخفى صندوق النجوم في وضع المهمة. يظهر خط الروت بإطار متباين فوق تضاريس CTX، ويعرض الـmini-map نقطة البداية والنهاية والتقدم ومخطط الارتفاع.

## 1. المتطلبات

- Windows 10/11 أو Linux/macOS.
- Node.js 22 LTS وnpm لتشغيل خادم محلي أو إعادة بناء المشروع.
- اتصال إنترنت لطبقات صور NASA الخارجية وتثبيت اعتماديات npm أول مرة. بيانات DEM نفسها موجودة داخل ZIP.

لا تفتح `frontend/build/index.html` بالنقر عليه مباشرة (`file://`). Cesium يحتاج إلى خادم HTTP محلي ليقرأ الأصول وملف الارتفاعات كما ينبغي.

## 2. التشغيل السريع على Windows

1. فكّ ضغط ZIP كاملًا إلى مجلد عادي، مع إبقاء بنية المجلدات كما هي.
2. ثبّت Node.js 22 LTS إذا لم يكن مثبتًا.
3. للتشغيل من نسخة الإنتاج الجاهزة، انقر مرتين على `RUN-BUILT-TAREEQ-Windows.bat`. افتح `http://localhost:4173` إذا لم يفتح المتصفح تلقائيًا. هذا الخيار لا يثبت حزم npm؛ يحتاج Node فقط لتقديم الملفات عبر HTTP.
4. للتشغيل أثناء التطوير، انقر `RUN-TAREEQ-Windows.bat`. يثبت الاعتماديات عند الحاجة ثم يشغّل React على `http://localhost:3000`. اترك نافذة الأوامر مفتوحة ما دمت تستخدم الموقع.

إذا ظهر أن المنفذ مشغول، أغلق تشغيلًا سابقًا أو غيّر المنفذ في `serve-build.js` (للإنتاج) أو إعداد CRA (للتطوير).

## 3. استخدام المنصة

- **3D VIEW:** استكشاف سطح المريخ ثلاثي الأبعاد. طبقات الصور وأدوات العرض موجودة في لوحة البيانات.
- **2D MAP:** قياس المسافة بين أي نقطتين بأداة القياس، واستعراض الطبقات المتاحة.
- **START MISSION:** ابحث عن موقعين مثل `Olympus Mons` و`Valles Marineris`، أو اختر النقطتين بالنقر على الخريطة. تظهر بدائل A* وUniform-Cost Search وGreedy Best-First مع المسافة وعدد العقد التي فُحصت.
- اختر بطاقة المسار التي تريدها واضغط **START MISSION** مرة أخرى. لا يعرض عارض المهمة الكرة كاملة: يبدأ من أول نقطة على المسار بمنظور مطاردة محلي، ويُظهر Curiosity الحقيقي ثلاثي الأبعاد وخط الطريق فوق السطح. تعرض الخريطة المصغّرة الروت كاملًا ومخطط ارتفاع من قيم CTX/MOLA الخام بمرجع areoid، مع مؤشر مكان rover. يمكن إيقاف الحركة واستئنافها والتحكم اليدوي عبر الأزرار ومفاتيح W/A/S/D أو الأسهم والمسافة.

لا تفتح ZIP الصور الخام ولا تعدّل ملفات الارتفاع. يستخدم مشهد Jezero قيم الارتفاع الأصلية المترية، ويجب أن يبقى أي DTM وصورة سطح مضافين متوافقين مكانيًا وموثقين للمنطقة نفسها.

يُنسب نموذج المركبة إلى **NASA/JPL-Caltech**، ويُضمَّن محليًا في `frontend/public/models/curiosity.glb` من [صفحة نموذج Curiosity الرسمية](https://science.nasa.gov/resource/curiosity-rover-3d-model/). طبقة hillshade والصورة الأساسية تأتيان من NASA Mars Trek، بينما DEM الرقمي مصدر مستقل.

## 4. DEM والخوارزميات — ما الذي تغيّر؟

ملف الارتفاع الافتراضي هو `frontend/public/data/megt90n000cb.img`، وهو شبكة NASA/PDS4 MGS MOLA MEGDR العالمية. يتولى الكود تحميل القيم الرقمية نفسها واستخدامها في كلفة المسار وفي تضاريس Cesium. كما تُحمّل شبكة `frontend/public/data/mega90n000cb.img` الرسمية لمرجع MOLA areoid وتحويل الارتفاع إلى Mars ellipsoid عند العرض؛ لا حاجة لإعداد DEM أو مفتاح API كي يعمل ذلك. ملفات `.xml` المرافقة تصف بيانات المنتجات وترميزها.

البيانات بدقة 4 عينات لكل درجة، أي خلايا تقارب 14.8 كم عند خط الاستواء. لذلك فهي مناسبة للتضاريس الإقليمية الواسعة، وليست خريطة عوائق أو انحدارات دقيقة على مقياس العربة. صورة MOLA الملونة أو hillshade طبقة بصرية منفصلة عن قيم الارتفاع الرقمية.

الكاميرا المحلية ونموذج rover وخط المسار يقدّمون تجربة mission، لكنهم لا يحوّلون صور hillshade إلى ارتفاعات دقيقة. ارتفاع الخط (+20 م) والـorigin المحلي المحسوب وطبقة الخط المسقطة على الشاشة كلها للعرض فقط؛ عينات DEM وتكاليف الطريق تبقى في مرجعها الأصلي، ولا يوجد vertical exaggeration. مخطط الارتفاع في mini-map يعرض قيم DTM الخام فوق الـareoid، لا قيم العرض بعد الإزاحة. تقرير [ROUTE-COVERAGE-REPORT.md](ROUTE-COVERAGE-REPORT.md) يسجل bounds المسار ونتيجة تغطية 92/92 waypoint وقيم الملف كاملةً في `reports/jezero-astar-route-profile.csv`. مرجع NASA عن المسار المقترح أعلى Mount Sharp استخدم بيانات محلية من HiRISE وCRISM وCTX مع مساهمات HRSC؛ تغطية HiRISE DTM مرتبطة بمناطق تصوير مجسّمة محددة. توجد خريطة USGS عالمية ممزوجة MOLA/HRSC بدقة 200 م، لكن GeoTIFF حجمه 11 GB وتغطية HRSC المضافة تقارب 44% من المريخ، لذا لم تُضمّن في ZIP. للحصول على تفاصيل من رتبة أمتار يلزم مزوّد ارتفاعات أدق يغطي منطقة المهمة، ويمكن إعداد مزوّد Cesium خارجي كما في قسم الإعدادات.

مصادر للمشهد وبياناته: [NASA — Curiosity's Proposed Path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/)، [USGS — DEM عالمي 200 م](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m)، و[PDS — HiRISE DTM](https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=MRO-M-HIRISE-5-DTM-V1.0).

- **`A*`:** يوازن المسافة وتكلفة التضاريس عبر heuristic؛ يُعرض كخيار متوازن.
- **Uniform-Cost Search:** يختار أقل كلفة تراكمية فعلية، بما فيها تأثير الانحدار؛ قد يفحص عقدًا أكثر ويختار مسارًا مختلفًا عن A*.
- **Greedy Best-First:** يوجّه البحث بالاقتراب من الهدف لتقليل جهد البحث، لكنه ليس مضمونًا أن يعطي أقل كلفة كلية.

اختبار الإنتاج من Olympus Mons إلى Valles Marineris أعاد نتائج مختلفة: `A*` نحو 5,068 كم، وUCS نحو 5,102 كم، وGreedy نحو 5,261 كم. هذا يؤكد أن Uniform-Cost يستخدم كلفة تضاريس تراكمية مستقلة، فلا يتطابق بالضرورة مع A*.

تفاصيل المنتج ومصادره الرسمية موجودة في [`frontend/public/data/README.md`](frontend/public/data/README.md):

- ملف PDS4 الخام: https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/megt90n000cb.img
- وسم المنتج: https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/megt90n000cb.xml
- توثيق MOLA MEGDR: https://pds-geosciences.wustl.edu/missions/mgs/megdr.html

## 5. بناء نسخة الإنتاج على Windows

أسهل طريقة هي النقر مرتين على `BUILD-TAREEQ-Windows.bat`. ينفذ فحص TypeScript والاختبارات ثم ينشئ الموقع النهائي داخل `frontend/build/`.

أو نفّذ يدويًا من مجلد المشروع:

```cmd
cd frontend
npm ci
npm run type-check
npm test -- --watchAll=false --runInBand
set GENERATE_SOURCEMAP=false
npm run build
```

للتأكد من اكتمال البناء، تحقق من وجود:

- `frontend/build/index.html`
- `frontend/build/cesium/`
- `frontend/build/data/megt90n000cb.img`
- `frontend/build/data/mega90n000cb.img`
- `frontend/build/data/jezero/jezero-ctx-dem-f32le.bin` و`frontend/build/data/jezero/jezero-ctx-orthophoto.png`
- `frontend/build/models/curiosity.glb`

في التحقق الحالي نجحت الأنواع، ونجحت اختبارات الواجهة، واكتمل بناء الإنتاج. تظهر بعض تحذيرات lint قديمة في أجزاء أخرى من المستودع؛ لا تمنع الاختبارات أو البناء.

## 6. النشر على استضافة Static

ارفع **محتويات** `frontend/build/` إلى جذر موقع ثابت مثل Cloudflare Pages أو Netlify أو GitHub Pages أو خادم Nginx. إذا كانت المنصة تنفذ البناء بنفسها، اضبط:

- مجلد العمل/‏Base directory: `frontend`
- نسخة Node: `22`
- أمر البناء: `npm ci && npm run build`
- مجلد النشر: `build`

يلزم أن يخدم الموقع الملفات عبر HTTPS، وأن يحافظ على مجلد `cesium/` و`data/`. إعداد `homepage: "."` يجعل مراجع الأصول نسبية وملائمة للاستضافة في جذر الموقع أو مجلد فرعي. أضف إعداد SPA fallback إلى `index.html` إذا كان مزوّد الاستضافة يتطلبه.

التشغيل الأساسي لا يحتاج Backend Python. تحتاج إلى API أو Backend فقط إذا أردت استخدام خدمات البلاطات/البيانات الخاصة بالمشروع أو تكاملاتك الإضافية. لا تستخدم Docker Compose في جذر المشروع كطريقة نشر الواجهة الثابتة؛ الحاوية المخصصة لها موضحة أدناه.

## 7. النشر عبر Docker Desktop (الواجهة فقط)

من جذر المشروع بعد تثبيت Docker Desktop:

```cmd
docker build -t tareeq-web -f frontend/Dockerfile frontend
docker run --rm -p 8080:8080 tareeq-web
```

ثم افتح `http://localhost:8080`. الصورة مبنية من Nginx وتحتوي على الواجهة وملفات Cesium وDEM. لا تشغّل Backend Python. هذا الخيار مناسب لاستضافة حاوية واجهة منفردة.

## 8. إعدادات اختيارية

انسخ `frontend/.env.example` إلى `frontend/.env` قبل البناء، وعدّل المتغيرات التي تحتاجها فقط. قيم `REACT_APP_*` تُدمج وقت البناء، لذا أعد تنفيذ `npm run build` بعد تغييرها.

- `REACT_APP_MARS_TERRAIN_URL`: مزوّد Mars DEM إضافي متوافق مع Cesium (quantized-mesh أو heightmap). إذا تُرك فارغًا، يستخدم التطبيق MOLA المضمّن. يجب أن يسمح الخادم بطلبات CORS من موقعك وأن يعيد بيانات تضاريس رقمية، لا صور hillshade أو WMS.
- `REACT_APP_USGS_MARS_GEOLOGY_WMS_URL` و`REACT_APP_USGS_MARS_GEOLOGY_WMS_LAYERS`: طبقة جيولوجيا اختيارية عبر WMS.
- `REACT_APP_API_URL` و`REACT_APP_WS_URL`: اتركهما غير مضبوطين للتجربة المضمّنة؛ لا تضبطهما إلا عند تشغيل Backend متوافق فعليًا.

## 9. استكشاف الأخطاء

- **صفحة فارغة أو Cesium لا يظهر:** استخدم `RUN-BUILT-TAREEQ-Windows.bat` أو خادم HTTP، ولا تستخدم `file://`. جرّب Chrome أو Edge حديثًا وتأكد أن WebGL مفعّل.
- **الصور الفضائية لا تُحمّل:** يلزم اتصال إنترنت بخدمات NASA Mars Trek. DEM المحلي يمكنه دعم حساب التضاريس حتى إن لم تتوفر صور NASA.
- **المهمة لا تعرض التضاريس أو الصور:** تحقق من بقاء `frontend/build/data/megt90n000cb.img` و`frontend/build/data/mega90n000cb.img` و`frontend/build/models/curiosity.glb` ومن خدمة مجلدي `build/data/` و`build/models/` عبر الخادم. hillshade الخارجية تحتاج اتصالًا بخدمة NASA؛ أما قيم DEM وareoid فتأتي من الملفات المحلية.
- **`npm ci` يفشل:** استخدم Node 22 مع اتصال إنترنت ومساحة كافية، ثم شغّل ملف Windows مجددًا.
- **المنفذ 4173 أو 3000 مستخدم:** أغلق خادمًا سابقًا أو غيّر المنفذ. أوقف خادم الإنتاج بـ`Ctrl+C` في نافذته.
