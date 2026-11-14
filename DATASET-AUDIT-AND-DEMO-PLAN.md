# تدقيق بيانات سطح المريخ وخطة مشهد المهمة — TAREEQ

## نتائج المصادر الرسمية

- صفحة USGS لمنتج Jezero CTX تصف DTM بدقة 20 م/بكسل، بأبعاد 1596 × 1512، وتغطية تقريبية 77.1605–77.699° شرقًا و18.211–18.721° شمالًا. الإسقاط Equirectangular على كرة Mars radius 3,396,190 م؛ خطوط العرض planetocentric، وخطوط الطول positive-east، والتحكم الرأسي مرتبط بـMOLA. الصفحة تصف أيضًا المنتج المطابق من CTX orthorectified images. دقة تسجيل شرائح CTX المكونة للموزاييك تقارب 9.6 م أفقيًا، والفرق الرأسي بين عناصر الـDTM كان 3.8 م بعد المحاذاة مع HRSC. [1]
- صفحة USGS لمنتج HiRISE DTM في Jezero تصف موزاييك بدقة 1 م/بكسل، بأبعاد 21,400 × 21,488، وتغطية 77.2229–77.584° شرقًا و18.3068–18.6693° شمالًا. المنتج محاذى إلى CTX؛ والفرق الرأسي الوسيط المبلغ عنه بين موزاييك HiRISE وCTX نحو 0.4 م. حجم التنزيل الكامل يقارب 1.8 GB. [2]
- صفحة USGS لأورثوموزاييك HiRISE المطابق تصف صورة grayscale بدقة 25 سم/بكسل وعلى التغطية نفسها. توثّق الصفحة إعادة الإسقاط/المحاذاة إلى مرجع CTX، وتذكر أن نحو 94.1% من المعالم المتطابقة تقع بإزاحة أقل من 6 م في مقارنة HiRISE/CTX. حجم النسخة الكاملة قرابة 6.9 GB. [3]
- توثيق PDS يوضح أن MOLA MEGDR خرائط ارتفاع عالمية من 4 إلى 128 عينة لكل درجة؛ ملف 4 ppd المضمّن في TAREEQ مناسب للسياق العالمي، لا لتفاصيل العربة. ملف USGS MOLA GeoTIFF بدقة 463 م/بكسل المذكور في السجل أكبر كثيرًا وليس موجودًا في مجلد المشروع الحالي. [4]
- مرجع NASA لمسار Curiosity على Mount Sharp يوضح أن المشهد المرجعي اعتمد بيانات متعددة من HiRISE وCRISM وCTX، مع مساهمة HRSC؛ لذلك فهو مرجع بصري لمشهد إقليمي مركب، وليس صورة واحدة أو DEM عالميًا. [5]

## مرجع الارتفاع قبل وضع بيانات CTX في Cesium

قيم CTX ليست ارتفاعات فوق ellipsoid: توثيق USGS يوضح أنها ارتفاعات أعلى أو أدنى من Mars geoid، المعروف باسم areoid، وأن تحويل ASP إلى هذا المرجع يتم عبر `dem_geoid`. لذلك لا يجوز تمرير قيمة CTX الخام على أنها ارتفاع ellipsoid من دون تحويل datum. [6]

يوضح PDS أن MOLA MEGDR يحتوي خرائط منفصلة لنصف قطر الكوكب والـareoid والـtopography، وأن topography هو الفرق بين نصف قطر السطح والـareoid. ملف `mega90n000cb.img` هو شبكة areoid عالمية 4 ppd، بقيم SignedMSB2 على خلايا 0.25°، مع قيمة مرجعية 3,396,000 م؛ وهو مناسب لاشتقاق فرق الارتفاع المحلي بدل افتراض +4,000 م ثابتة. [7] [8]

فحص نقطة Jezero عند 77.440°E, 18.460°N باستخدام CTX محلي وMOLA areoid الرسمي يعطي topography مصدرية تقارب −2,608 م، وارتفاعًا فوق Mars reference ellipsoid يقارب −2,281 م. فرق الـareoid عن ellipsoid عند هذه النقطة يقارب +327 م. هذا يثبت أن إزاحة +4,000 م القديمة لم تكن تحويل vertical datum صحيحًا. التطبيق يبقي عينات CTX وتكاليف التخطيط على قيمها الأصلية، ويستخدم شبكة areoid الرسمية لتحويل الارتفاع عند بناء إحداثيات Cesium. ثم يضيف origin ثابتًا محسوبًا للمسار محليًا لتفادي عرض المشهد داخل ellipsoid، ورفعًا عرضيًا قدره 20 م لخط الطريق لتجنّب حجبه أو z-fighting فوق شبكة CTX. هذان تعديلان للعرض فقط، لا تعديل للبيانات أو تكبيرًا رأسيًا للتضاريس.

## تدقيق الملفات الموجودة فعلًا في مجلد المشروع

الملفات الخام الموجودة في المشروع الآن هي CTX Jezero DTM المطابق لأورثوفوتو CTX، وملفا MOLA العالميين 4 ppd للتضاريس والـareoid المضمّنان في الواجهة. لم يُعثر في مجلد المشروع على ملفات HiRISE raster أو على بقية منتجات CTX التي تظهر في تقارير المستخدم. سجلات المستخدم تصنف HiRISE على أنها `READY_REMOTE`/قراءة بعيدة؛ وهي ليست تنزيلًا محليًا حاضرًا في هذه النسخة.

ملف CTX DTM المحلي أبعاده 1596 × 1512، نوعه float32، ودقته 20 م، وNoData هو `-3.4028e38`. إسقاطه `ESRI:103885`، وهو Mars Equirectangular، موجب شرقًا وبخط عرض planetocentric. امتداده المسقط: x=4,573,663.251 إلى 4,605,583.251 م، وy=1,079,453.140 إلى 1,109,693.140 م. بعد التحويل إلى الإحداثيات المريخية الجغرافية: 77.160465–77.698975° شرقًا و18.211027–18.721194° شمالًا.

الأورثوفوتو المطابقة أبعادها 5322 × 5040، نوعها uint8، ودقتها 6 م، وهي على CRS وامتداد رأسي مطابقين للـDTM. تمتد 12 م إضافية شرق الحد الأقصى للـDTM؛ التقاطع يغطي 100% من footprint الـDTM. قيم DTM الأصلية ارتفاعات مترية مرتبطة بمرجع MOLA/Delta Geoid؛ تبقى العينات المصدرية دون تعديل. يحوّلها التطبيق إلى Mars ellipsoid لعرض Cesium، ويستخدم origin محليًا وخط route على ارتفاع عرضي +20 م دون تعديل raw DEM أو route costs.

تحتوي تقارير المستخدم كذلك على CTX Jezero DTM/orthophoto آخر بإسقاط مركزي مختلف (central meridian 180° بدل 0°). عند تحويل CRS الخاص به إلى إحداثيات Mars geodetic، يتداخل مكانه مع footprint الملف المحلي؛ لذلك لا يصح استنتاج عدم التداخل من أرقام x/y الخام وحدها. هذه الملفات الأخرى ليست موجودة في مجلد المشروع الحالي، ولن تُدمج لمجرد تشابه الاسم.

## اختيار نسخة العرض

المسار الافتراضي للمهمة يجب أن يبقى داخل تقاطع CTX DTM وorthophoto المحليين في Jezero، مع عرض المصدر والدقة بوضوح. يبقى MOLA 4 ppd خيارًا للسياق العالمي وخارج تغطية CTX، مع تحذير أن دقته غير مناسبة لتفادي أخطار rover-scale. منتجات HiRISE أكثر تفصيلًا ومحاذاة رسميًا إلى CTX، لكنها ليست محلية في نسخة المشروع وحجومها الكاملة لا تناسب ZIP صغيرًا؛ يمكن لاحقًا أخذ منطقة مشتركة محددة بعد فحص ملفاتها وCRS ومحاذاتها، وليس خلطها عشوائيًا.

**حالة الاختبار البصري (14 نوفمبر 2026):** اجتاز مشهد Chromium التفاعلي التحقق بعد إخفاء صور MOLA/Viking العالمية أثناء Jezero mission، ما أظهر CTX grayscale orthophoto فوق تضاريس CTX DTM الحقيقية. ظهرت العربة، والـroute highlight المشتق من نقاط 3D، والكاميرا المتابعة والـmini-map معًا. تقرير A* للمسار التجريبي سجّل 92/92 waypoint داخل التداخل المشترك، بلا NoData أو مقاطع خارج التغطية. أضيف أيضًا profile ارتفاع من عينات CTX المصدرية بمرجع areoid، مع مؤشر rover الحالي. راجع `ROUTE-COVERAGE-REPORT.md` و`reports/jezero-astar-route-profile.csv` للتفاصيل. لا تزال النسخة نموذجًا وظيفيًا وليست بمستوى fidelity اللعبة المرجعية.

## المراجع

[1]: https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic "USGS Mars 2020 Terrain Relative Navigation CTX DTM Mosaic"
[2]: https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic "USGS Mars 2020 Terrain Relative Navigation HiRISE DTM Mosaic"
[3]: https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_orthorectified_image_mosaic "USGS Mars 2020 Terrain Relative Navigation HiRISE Orthorectified Image Mosaic"
[4]: https://pds-geosciences.wustl.edu/missions/mgs/megdr.html "PDS Geosciences Node MGS MOLA MEGDRs"
[5]: https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/ "NASA Curiosity’s Proposed Path up Mount Sharp"
[6]: https://stac.astrogeology.usgs.gov/docs/data/mars/ctxdtms/ "USGS ASP Generated CTX DTMs and Orthoimages"
[7]: https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m "USGS Mars MGS MOLA DEM"
[8]: https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/mega90n000cb.xml "PDS4 MOLA Areoid Grid Label"
