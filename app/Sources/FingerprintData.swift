import Foundation

// MARK: - 城市 / 时区 / 语言

public struct CityInfo {
    public let city: String
    public let country: String
    public let cc: String
    public let timezone: String
    public let locale: String
    public let languages: [String]
    public let lat: Double
    public let lon: Double
}

public enum GeoDB {
    public static let cities: [CityInfo] = [
        .init(city:"New York",country:"United States",cc:"US",timezone:"America/New_York",locale:"en-US",languages:["en-US","en"],lat:40.7128,lon:-74.0060),
        .init(city:"Los Angeles",country:"United States",cc:"US",timezone:"America/Los_Angeles",locale:"en-US",languages:["en-US","en"],lat:34.0522,lon:-118.2437),
        .init(city:"Chicago",country:"United States",cc:"US",timezone:"America/Chicago",locale:"en-US",languages:["en-US","en"],lat:41.8781,lon:-87.6298),
        .init(city:"Houston",country:"United States",cc:"US",timezone:"America/Chicago",locale:"en-US",languages:["en-US","en"],lat:29.7604,lon:-95.3698),
        .init(city:"Phoenix",country:"United States",cc:"US",timezone:"America/Phoenix",locale:"en-US",languages:["en-US","en"],lat:33.4484,lon:-112.0740),
        .init(city:"Miami",country:"United States",cc:"US",timezone:"America/New_York",locale:"es-US",languages:["es-US","es","en-US","en"],lat:25.7617,lon:-80.1918),
        .init(city:"Seattle",country:"United States",cc:"US",timezone:"America/Los_Angeles",locale:"en-US",languages:["en-US","en"],lat:47.6062,lon:-122.3321),
        .init(city:"Denver",country:"United States",cc:"US",timezone:"America/Denver",locale:"en-US",languages:["en-US","en"],lat:39.7392,lon:-104.9903),
        .init(city:"Boston",country:"United States",cc:"US",timezone:"America/New_York",locale:"en-US",languages:["en-US","en"],lat:42.3601,lon:-71.0589),
        .init(city:"Toronto",country:"Canada",cc:"CA",timezone:"America/Toronto",locale:"en-CA",languages:["en-CA","en","fr-CA","fr"],lat:43.6532,lon:-79.3832),
        .init(city:"Vancouver",country:"Canada",cc:"CA",timezone:"America/Vancouver",locale:"en-CA",languages:["en-CA","en"],lat:49.2827,lon:-123.1207),
        .init(city:"Montreal",country:"Canada",cc:"CA",timezone:"America/Toronto",locale:"fr-CA",languages:["fr-CA","fr","en-CA","en"],lat:45.5019,lon:-73.5674),
        .init(city:"London",country:"United Kingdom",cc:"GB",timezone:"Europe/London",locale:"en-GB",languages:["en-GB","en"],lat:51.5074,lon:-0.1278),
        .init(city:"Manchester",country:"United Kingdom",cc:"GB",timezone:"Europe/London",locale:"en-GB",languages:["en-GB","en"],lat:53.4808,lon:-2.2426),
        .init(city:"Birmingham",country:"United Kingdom",cc:"GB",timezone:"Europe/London",locale:"en-GB",languages:["en-GB","en"],lat:52.4862,lon:-1.8904),
        .init(city:"Dublin",country:"Ireland",cc:"IE",timezone:"Europe/Dublin",locale:"en-IE",languages:["en-IE","en"],lat:53.3498,lon:-6.2603),
        .init(city:"Paris",country:"France",cc:"FR",timezone:"Europe/Paris",locale:"fr-FR",languages:["fr-FR","fr"],lat:48.8566,lon:2.3522),
        .init(city:"Marseille",country:"France",cc:"FR",timezone:"Europe/Paris",locale:"fr-FR",languages:["fr-FR","fr"],lat:43.2965,lon:5.3698),
        .init(city:"Berlin",country:"Germany",cc:"DE",timezone:"Europe/Berlin",locale:"de-DE",languages:["de-DE","de"],lat:52.5200,lon:13.4050),
        .init(city:"Hamburg",country:"Germany",cc:"DE",timezone:"Europe/Berlin",locale:"de-DE",languages:["de-DE","de"],lat:53.5511,lon:9.9937),
        .init(city:"Munich",country:"Germany",cc:"DE",timezone:"Europe/Berlin",locale:"de-DE",languages:["de-DE","de"],lat:48.1351,lon:11.5820),
        .init(city:"Frankfurt",country:"Germany",cc:"DE",timezone:"Europe/Berlin",locale:"de-DE",languages:["de-DE","de"],lat:50.1109,lon:8.6821),
        .init(city:"Madrid",country:"Spain",cc:"ES",timezone:"Europe/Madrid",locale:"es-ES",languages:["es-ES","es"],lat:40.4168,lon:-3.7038),
        .init(city:"Barcelona",country:"Spain",cc:"ES",timezone:"Europe/Madrid",locale:"es-ES",languages:["es-ES","es","ca"],lat:41.3874,lon:2.1686),
        .init(city:"Rome",country:"Italy",cc:"IT",timezone:"Europe/Rome",locale:"it-IT",languages:["it-IT","it"],lat:41.9028,lon:12.4964),
        .init(city:"Milan",country:"Italy",cc:"IT",timezone:"Europe/Rome",locale:"it-IT",languages:["it-IT","it"],lat:45.4642,lon:9.1900),
        .init(city:"Amsterdam",country:"Netherlands",cc:"NL",timezone:"Europe/Amsterdam",locale:"nl-NL",languages:["nl-NL","nl","en-US","en"],lat:52.3676,lon:4.9041),
        .init(city:"Brussels",country:"Belgium",cc:"BE",timezone:"Europe/Brussels",locale:"nl-BE",languages:["nl-BE","nl","fr-BE","fr"],lat:50.8503,lon:4.3517),
        .init(city:"Zurich",country:"Switzerland",cc:"CH",timezone:"Europe/Zurich",locale:"de-CH",languages:["de-CH","de","fr-CH","fr","it-CH","it"],lat:47.3769,lon:8.5417),
        .init(city:"Vienna",country:"Austria",cc:"AT",timezone:"Europe/Vienna",locale:"de-AT",languages:["de-AT","de"],lat:48.2082,lon:16.3738),
        .init(city:"Stockholm",country:"Sweden",cc:"SE",timezone:"Europe/Stockholm",locale:"sv-SE",languages:["sv-SE","sv","en-US","en"],lat:59.3293,lon:18.0686),
        .init(city:"Oslo",country:"Norway",cc:"NO",timezone:"Europe/Oslo",locale:"nb-NO",languages:["nb-NO","nb","no","en-US","en"],lat:59.9139,lon:10.7522),
        .init(city:"Copenhagen",country:"Denmark",cc:"DK",timezone:"Europe/Copenhagen",locale:"da-DK",languages:["da-DK","da","en-US","en"],lat:55.6761,lon:12.5683),
        .init(city:"Helsinki",country:"Finland",cc:"FI",timezone:"Europe/Helsinki",locale:"fi-FI",languages:["fi-FI","fi","en-US","en"],lat:60.1699,lon:24.9384),
        .init(city:"Warsaw",country:"Poland",cc:"PL",timezone:"Europe/Warsaw",locale:"pl-PL",languages:["pl-PL","pl"],lat:52.2297,lon:21.0122),
        .init(city:"Prague",country:"Czechia",cc:"CZ",timezone:"Europe/Prague",locale:"cs-CZ",languages:["cs-CZ","cs"],lat:50.0755,lon:14.4378),
        .init(city:"Budapest",country:"Hungary",cc:"HU",timezone:"Europe/Budapest",locale:"hu-HU",languages:["hu-HU","hu"],lat:47.4979,lon:19.0402),
        .init(city:"Athens",country:"Greece",cc:"GR",timezone:"Europe/Athens",locale:"el-GR",languages:["el-GR","el"],lat:37.9838,lon:23.7275),
        .init(city:"Lisbon",country:"Portugal",cc:"PT",timezone:"Europe/Lisbon",locale:"pt-PT",languages:["pt-PT","pt"],lat:38.7223,lon:-9.1393),
        .init(city:"Moscow",country:"Russia",cc:"RU",timezone:"Europe/Moscow",locale:"ru-RU",languages:["ru-RU","ru"],lat:55.7558,lon:37.6173),
        .init(city:"Saint Petersburg",country:"Russia",cc:"RU",timezone:"Europe/Moscow",locale:"ru-RU",languages:["ru-RU","ru"],lat:59.9311,lon:30.3609),
        .init(city:"Kyiv",country:"Ukraine",cc:"UA",timezone:"Europe/Kyiv",locale:"uk-UA",languages:["uk-UA","uk","ru-UA","ru"],lat:50.4501,lon:30.5234),
        .init(city:"Istanbul",country:"Türkiye",cc:"TR",timezone:"Europe/Istanbul",locale:"tr-TR",languages:["tr-TR","tr"],lat:41.0082,lon:28.9784),
        .init(city:"Tel Aviv",country:"Israel",cc:"IL",timezone:"Asia/Jerusalem",locale:"he-IL",languages:["he-IL","he","ar","en"],lat:32.0853,lon:34.7818),
        .init(city:"Dubai",country:"United Arab Emirates",cc:"AE",timezone:"Asia/Dubai",locale:"ar-AE",languages:["ar-AE","ar","en"],lat:25.2048,lon:55.2708),
        .init(city:"Riyadh",country:"Saudi Arabia",cc:"SA",timezone:"Asia/Riyadh",locale:"ar-SA",languages:["ar-SA","ar"],lat:24.7136,lon:46.6753),
        .init(city:"Mumbai",country:"India",cc:"IN",timezone:"Asia/Kolkata",locale:"en-IN",languages:["en-IN","hi-IN","hi","en"],lat:19.0760,lon:72.8777),
        .init(city:"New Delhi",country:"India",cc:"IN",timezone:"Asia/Kolkata",locale:"hi-IN",languages:["hi-IN","hi","en-IN","en"],lat:28.6139,lon:77.2090),
        .init(city:"Bengaluru",country:"India",cc:"IN",timezone:"Asia/Kolkata",locale:"en-IN",languages:["en-IN","en"],lat:12.9716,lon:77.5946),
        .init(city:"Singapore",country:"Singapore",cc:"SG",timezone:"Asia/Singapore",locale:"en-SG",languages:["en-SG","en","zh-SG","zh","ms"],lat:1.3521,lon:103.8198),
        .init(city:"Tokyo",country:"Japan",cc:"JP",timezone:"Asia/Tokyo",locale:"ja-JP",languages:["ja-JP","ja","en-US","en"],lat:35.6762,lon:139.6503),
        .init(city:"Osaka",country:"Japan",cc:"JP",timezone:"Asia/Tokyo",locale:"ja-JP",languages:["ja-JP","ja"],lat:34.6937,lon:135.5023),
        .init(city:"Seoul",country:"South Korea",cc:"KR",timezone:"Asia/Seoul",locale:"ko-KR",languages:["ko-KR","ko"],lat:37.5665,lon:126.9780),
        .init(city:"Hong Kong",country:"Hong Kong",cc:"HK",timezone:"Asia/Hong_Kong",locale:"zh-HK",languages:["zh-HK","zh-TW","zh","en-US","en"],lat:22.3193,lon:114.1694),
        .init(city:"Taipei",country:"Taiwan",cc:"TW",timezone:"Asia/Taipei",locale:"zh-TW",languages:["zh-TW","zh","en-US","en"],lat:25.0330,lon:121.5654),
        .init(city:"Shanghai",country:"China",cc:"CN",timezone:"Asia/Shanghai",locale:"zh-CN",languages:["zh-CN","zh","en-US","en"],lat:31.2304,lon:121.4737),
        .init(city:"Beijing",country:"China",cc:"CN",timezone:"Asia/Shanghai",locale:"zh-CN",languages:["zh-CN","zh"],lat:39.9042,lon:116.4074),
        .init(city:"Shenzhen",country:"China",cc:"CN",timezone:"Asia/Shanghai",locale:"zh-CN",languages:["zh-CN","zh"],lat:22.5431,lon:114.0579),
        .init(city:"Bangkok",country:"Thailand",cc:"TH",timezone:"Asia/Bangkok",locale:"th-TH",languages:["th-TH","th","en-US","en"],lat:13.7563,lon:100.5018),
        .init(city:"Jakarta",country:"Indonesia",cc:"ID",timezone:"Asia/Jakarta",locale:"id-ID",languages:["id-ID","id","en"],lat:-6.2088,lon:106.8456),
        .init(city:"Kuala Lumpur",country:"Malaysia",cc:"MY",timezone:"Asia/Kuala_Lumpur",locale:"ms-MY",languages:["ms-MY","ms","en-US","en"],lat:3.1390,lon:101.6869),
        .init(city:"Manila",country:"Philippines",cc:"PH",timezone:"Asia/Manila",locale:"en-PH",languages:["en-PH","en","tl"],lat:14.5995,lon:120.9842),
        .init(city:"Hanoi",country:"Vietnam",cc:"VN",timezone:"Asia/Ho_Chi_Minh",locale:"vi-VN",languages:["vi-VN","vi","en"],lat:21.0278,lon:105.8342),
        .init(city:"Sydney",country:"Australia",cc:"AU",timezone:"Australia/Sydney",locale:"en-AU",languages:["en-AU","en"],lat:-33.8688,lon:151.2093),
        .init(city:"Melbourne",country:"Australia",cc:"AU",timezone:"Australia/Melbourne",locale:"en-AU",languages:["en-AU","en"],lat:-37.8136,lon:144.9631),
        .init(city:"Brisbane",country:"Australia",cc:"AU",timezone:"Australia/Brisbane",locale:"en-AU",languages:["en-AU","en"],lat:-27.4698,lon:153.0251),
        .init(city:"Auckland",country:"New Zealand",cc:"NZ",timezone:"Pacific/Auckland",locale:"en-NZ",languages:["en-NZ","en"],lat:-36.8485,lon:174.7633),
        .init(city:"São Paulo",country:"Brazil",cc:"BR",timezone:"America/Sao_Paulo",locale:"pt-BR",languages:["pt-BR","pt"],lat:-23.5505,lon:-46.6333),
        .init(city:"Rio de Janeiro",country:"Brazil",cc:"BR",timezone:"America/Sao_Paulo",locale:"pt-BR",languages:["pt-BR","pt"],lat:-22.9068,lon:-43.1729),
        .init(city:"Mexico City",country:"Mexico",cc:"MX",timezone:"America/Mexico_City",locale:"es-MX",languages:["es-MX","es"],lat:19.4326,lon:-99.1332),
        .init(city:"Buenos Aires",country:"Argentina",cc:"AR",timezone:"America/Argentina/Buenos_Aires",locale:"es-AR",languages:["es-AR","es"],lat:-34.6037,lon:-58.3816),
        .init(city:"Santiago",country:"Chile",cc:"CL",timezone:"America/Santiago",locale:"es-CL",languages:["es-CL","es"],lat:-33.4489,lon:-70.6693),
        .init(city:"Bogotá",country:"Colombia",cc:"CO",timezone:"America/Bogota",locale:"es-CO",languages:["es-CO","es"],lat:4.7110,lon:-74.0721),
        .init(city:"Lima",country:"Peru",cc:"PE",timezone:"America/Lima",locale:"es-PE",languages:["es-PE","es"],lat:-12.0464,lon:-77.0428),
        .init(city:"Johannesburg",country:"South Africa",cc:"ZA",timezone:"Africa/Johannesburg",locale:"en-ZA",languages:["en-ZA","en","af"],lat:-26.2041,lon:28.0473),
        .init(city:"Cape Town",country:"South Africa",cc:"ZA",timezone:"Africa/Johannesburg",locale:"en-ZA",languages:["en-ZA","en","af"],lat:-33.9249,lon:18.4241),
        .init(city:"Cairo",country:"Egypt",cc:"EG",timezone:"Africa/Cairo",locale:"ar-EG",languages:["ar-EG","ar"],lat:30.0444,lon:31.2357),
        .init(city:"Lagos",country:"Nigeria",cc:"NG",timezone:"Africa/Lagos",locale:"en-NG",languages:["en-NG","en"],lat:6.5244,lon:3.3792),
        .init(city:"Nairobi",country:"Kenya",cc:"KE",timezone:"Africa/Nairobi",locale:"en-KE",languages:["en-KE","en","sw"],lat:-1.2921,lon:36.8219),
        .init(city:"Casablanca",country:"Morocco",cc:"MA",timezone:"Africa/Casablanca",locale:"fr-MA",languages:["fr-MA","fr","ar-MA","ar"],lat:33.5731,lon:-7.5898),
        .init(city:"Reykjavík",country:"Iceland",cc:"IS",timezone:"Atlantic/Reykjavik",locale:"is-IS",languages:["is-IS","is","en-US","en"],lat:64.1466,lon:-21.9426),
    ]
    public static func byCountry(_ cc: String) -> [CityInfo] { cities.filter { $0.cc.uppercased() == cc.uppercased() } }
    public static func byTimezone(_ tz: String) -> CityInfo? { cities.first { $0.timezone == tz } }
}

// MARK: - 显卡 (WebGL UNMASKED_RENDERER)

public struct GpuInfo { public let vendor: String; public let renderer: String }

public enum GpuDB {
    public static let windows: [GpuInfo] = [
        .init(vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA Quadro P1000 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (AMD)", renderer:"ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (AMD)", renderer:"ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (AMD)", renderer:"ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (Intel)", renderer:"ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (Intel)", renderer:"ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (Intel)", renderer:"ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        .init(vendor:"Google Inc. (Intel)", renderer:"ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ]
    public static let mac: [GpuInfo] = [
        .init(vendor:"Google Inc. (Apple)", renderer:"ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)"),
        .init(vendor:"Google Inc. (Apple)", renderer:"ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)"),
        .init(vendor:"Google Inc. (Apple)", renderer:"ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)"),
        .init(vendor:"Google Inc. (Apple)", renderer:"ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)"),
        .init(vendor:"Google Inc. (Apple)", renderer:"ANGLE (Apple, ANGLE Metal Renderer: Intel(R) UHD Graphics 630, Unspecified Version)"),
        .init(vendor:"Google Inc. (Apple)", renderer:"ANGLE (Apple, ANGLE Metal Renderer: AMD Radeon Pro 5500M, Unspecified Version)"),
    ]
    public static let linux: [GpuInfo] = [
        .init(vendor:"Google Inc. (NVIDIA Corporation)", renderer:"ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2, OpenGL 4.5.0)"),
        .init(vendor:"Google Inc. (Intel)", renderer:"ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)"),
        .init(vendor:"Google Inc. (AMD)", renderer:"ANGLE (AMD, AMD Radeon RX 570 (radeonsi, polaris10, LLVM 15.0.7, DRM 3.49), OpenGL 4.6)"),
    ]
    public static func forPlatform(_ p: String) -> [GpuInfo] {
        switch p { case "mac": return mac; case "linux": return linux; default: return windows }
    }
}

// MARK: - 字体

public enum FontDB {
    public static let windows: [String] = [
        "Arial","Arial Black","Arial Narrow","Bahnschrift","Calibri","Cambria","Cambria Math","Candara",
        "Comic Sans MS","Consolas","Constantia","Corbel","Courier New","Ebrima","Franklin Gothic Medium",
        "Gabriola","Gadugi","Georgia","HoloLens MDL2 Assets","Impact","Ink Free","Javanese Text",
        "Leelawadee UI","Lucida Console","Lucida Sans Unicode","Malgun Gothic","Marlett","Microsoft Himalaya",
        "Microsoft JhengHei","Microsoft New Tai Lue","Microsoft PhagsPa","Microsoft Sans Serif","Microsoft Tai Le",
        "Microsoft YaHei","Microsoft Yi Baiti","MingLiU-ExtB","Mongolian Baiti","MS Gothic","MS Outlook",
        "MS Reference Sans Serif","MS UI Gothic","MV Boli","Myanmar Text","Nirmala UI","Palatino Linotype",
        "Segoe MDL2 Assets","Segoe Print","Segoe Script","Segoe UI","Segoe UI Emoji","Segoe UI Historic",
        "Segoe UI Semibold","Segoe UI Symbol","SimSun","Sitka Text","Sylfaen","Symbol","Tahoma","Times New Roman",
        "Trebuchet MS","Verdana","Webdings","Wingdings","Yu Gothic",
    ]
    public static let mac: [String] = [
        "American Typewriter","Andale Mono","Apple Braille","Apple Chancery","Apple Color Emoji","Apple SD Gothic Neo",
        "AppleGothic","Arial","Arial Black","Arial Hebrew","Arial Narrow","Arial Rounded MT Bold","Arial Unicode MS",
        "Avenir","Avenir Next","Avenir Next Condensed","Ayuthaya","Baghdad","Baskerville","Bauhaus 93","Beirut",
        "BiauKai","Big Caslon","BlinkMacSystemFont","Bodoni 72","Bodoni Ornaments","Brush Script MT","Chalkboard",
        "Chalkboard SE","Chalkduster","Charter","Cochin","Comic Sans MS","Copperplate","Corsiva Hebrew","Courier",
        "Courier New","DIN Alternate","DIN Condensed","Damascus","Devanagari Sangam MN","Didot","Diwan Kufi","Euphemia UCAS",
        "Farah","Futura","Galvji","Geeza Pro","Geneva","Georgia","Gill Sans","Gujarati Sangam MN","Gurmukhi MN",
        "Heiti SC","Heiti TC","Helvetica","Helvetica Neue","Herculanum","Hiragino Kaku Gothic Pro","Hiragino Maru Gothic ProN",
        "Hiragino Mincho Pro","Hiragino Sans","Hiragino Sans GB","Hoefler Text","Impact","InaiMathi","Iowan Old Style",
        "Kailasa","Kannada Sangam MN","Kefa","Khmer Sangam MN","Kohinoor Bangla","Kokonor","Krungthep","KufiStandardGK",
        "Lao Sangam MN","Lucida Grande","Luminari","Malayalam Sangam MN","Marion","Marker Felt","Menlo","Microsoft Sans Serif",
        "Mishafi","Monaco","Mshtakan","Mukta Mahee","Muna","Myanmar MN","Myanmar Sangam MN","Nadeem","Nanum Brush Script",
        "Nanum Gothic","Nanum Myeongjo","Nanum Pen Script","NanumGothic","New Peninim MT","Noteworthy","Optima","Oriya Sangam MN",
        "Osaka","PCMyungjo","Palatino","Papyrus","Party LET","Phosphate","PingFang HK","PingFang SC","PingFang TC","Plantagenet Cherokee",
        "PT Mono","PT Sans","PT Sans Caption","PT Sans Narrow","PT Serif","PT Serif Caption","Raanana","Rockwell","Sana","Sathu",
        "Savoye LET","Seravek","Shree Devanagari 714","SignPainter","Silom","Skia","Snell Roundhand","Songti SC","Songti TC",
        "STFangsong","STHeiti","STIX Two Math","STIXIntegralsD","STIXIntegralsUp","STIXIntegralsUpD","STIXIntegralsUpSm","STIXNonUnicode",
        "STIXSizeFiveSym","STIXSizeOneSym","STIXSizeOneSymHoriz","STIXSizeThreeSym","STIXSizeTwoSym","STIXVariants","Sukhumvit Set",
        "Superclarendon","Symbol","Tahoma","Telugu Sangam MN","Thonburi","Times","Times New Roman","Trattatello","Trebuchet MS",
        "Verdana","Waseem","Webdings","Wingdings","Wingdings 2","Wingdings 3","Zapf Dingbats","Zapfino",
    ]
    public static let linux: [String] = [
        "Cantarell","Courier 10 Pitch","Courier New","DejaVu Math TeX Gyre","DejaVu Sans","DejaVu Sans Mono",
        "DejaVu Serif","Droid Arabic Kufi","Droid Naskh Shift Alt","Droid Sans","Droid Sans Armenian","Droid Sans Ethiopic",
        "Droid Sans Fallback","Droid Sans Georgian","Droid Sans Hebrew","Droid Sans Japanese","Droid Sans Mono","Droid Serif",
        "FreeMono","FreeSans","FreeSerif","KacstArt","KacstBook","Khmer OS","Laksaman","Liberation Mono","Liberation Sans",
        "Liberation Sans Narrow","Liberation Serif","LKLUG Sans","Lohit Assamese","Lohit Bengali","Lohit Devanagari",
        "mry_KacstQurn","NanumBarunGothic","NanumGothic","Nimbus Mono L","Nimbus Roman No9 L","Nimbus Sans L",
        "Noto Color Emoji","Noto Kufi Arabic","Noto Mono","Noto Naskh Arabic","Noto Nastaliq Urdu","Noto Sans","Noto Sans CJK",
        "Noto Sans Thai","Noto Serif","OpenSymbol","P052","Purisa","Rachana","Samyak Gujarati","Tibetan Machine Uni",
        "Times New Roman","Tlwg Mono","Ubuntu","Ubuntu Condensed","Ubuntu Mono","URW Bookman L","URW Gothic L","URW Palladio L",
        "Utopia","Waree","WenQuanYi Micro Hei","WenQuanYi Zen Hei","Z003",
    ]
    public static func forPlatform(_ p: String) -> [String] {
        switch p { case "mac": return mac; case "linux": return linux; default: return windows }
    }
}

// MARK: - 屏幕分辨率

public enum ScreenDB {
    /// (width, height, 常见度权重, 是否Retina)
    public static let windows: [(Int,Int,Int,Bool)] = [
        (1920,1080,30,false),(2560,1440,14,false),(1366,768,10,false),(1536,864,9,false),
        (1600,900,7,false),(1440,900,4,false),(1280,720,4,false),(1280,1024,3,false),
        (1680,1050,3,false),(1920,1200,6,false),(3840,2160,4,false),(2560,1080,3,false),
        (3440,1440,2,false),(1280,800,1,false),
    ]
    public static let mac: [(Int,Int,Int,Bool)] = [
        (1512,982,20,true),(1728,1117,16,true),(2560,1440,10,false),(1920,1080,10,false),
        (3024,1964,9,true),(2880,1800,8,true),(1440,900,7,true),(3456,2234,5,true),
        (2048,1280,5,true),(1680,1050,4,true),(1280,800,3,true),(3840,2160,3,false),
    ]
    public static let linux: [(Int,Int,Int,Bool)] = [
        (1920,1080,34,false),(2560,1440,16,false),(1366,768,10,false),(1600,900,8,false),
        (1536,864,8,false),(1920,1200,7,false),(3840,2160,5,false),(1280,1024,4,false),
        (1680,1050,4,false),(2560,1080,4,false),
    ]
    public static func forPlatform(_ p: String) -> [(Int,Int,Int,Bool)] {
        switch p { case "mac": return mac; case "linux": return linux; default: return windows }
    }
}
