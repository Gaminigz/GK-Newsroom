//
//  NativeApp.swift — the native SwiftUI core of 3una 5aha.
//
//  Built for App Review guideline 4.2: the buyer experience (Home, Shop,
//  Orders, Map, Account) is fully native, talking to the JSON API at
//  /app/api/*. The webview remains only for secondary flows (profile,
//  shop-owner dashboard, legal pages) via WebSheet.
//

import SwiftUI
import MapKit
import WebKit
import AuthenticationServices

// MARK: - Config

enum API {
    static let base = URL(string: "https://web-production-2b43c.up.railway.app")!
    static let lkrPerUSD = 300.0

    static func money(_ lkr: Int) -> String {
        let usd = Double(lkr) / lkrPerUSD
        return String(format: "US$%.2f · LKR %@", usd, Self.grouped(lkr))
    }
    static func grouped(_ n: Int) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }
}

// MARK: - Models

struct HomeResponse: Codable {
    let city: String?
    let flash: [FlashItem]
    let shops: [ShopSummary]
}

struct FlashItem: Codable, Identifiable {
    let id: String
    let shopId: String
    let name: String
    let nameSi: String
    let price: Int
    let deal: String
    let shop: String
    let window: String
    let photo: String
    let tag: String
}

struct ShopSummary: Codable, Identifiable {
    let id: String
    let name: String
    let city: String
    let logo: String
    let rating: Double
    let dishes: Int
    let open: Bool
    let deal: String
    let lat: Double?
    let lng: Double?
    // Optional hero-slider photos — logo → frontPhoto → photo2 fade cycle.
    let frontPhoto: String?
    let photo2: String?
    let photo3: String?
}

struct ShopDetailResponse: Codable {
    let shop: ShopInfo
    let special: Dish?
    let dishes: [Dish]
}

struct ShopInfo: Codable {
    let id: String
    let name: String
    let city: String
    let country: String
    let logo: String
    let frontPhoto: String
    let open: Bool
}

struct Dish: Codable, Identifiable {
    let id: String
    let name: String
    let nameSi: String
    let price: Int
    let photo: String
    let window: String
    let discount: String
    let tag: String?
    let category: String?
    /// Which service windows this dish covers — server-classified from `window`.
    let meals: [String]?
}

struct OrdersResponse: Codable { let orders: [OrderSummary] }

struct OrderSummary: Codable, Identifiable {
    let id: String
    let shop: String
    let items: [OrderLine]
    let total: Int
    let status: String
    let pickupAt: String
}

struct OrderLine: Codable {
    let name: String
    let qty: Int
    let price: Int
}

// MARK: - API client

enum Net {
    static func get<T: Codable>(_ path: String, as type: T.Type) async throws -> T {
        let (data, _) = try await URLSession.shared.data(from: API.base.appendingPathComponent(path))
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func getQuery<T: Codable>(_ path: String, query: [String: String], as type: T.Type) async throws -> T {
        var comps = URLComponents(url: API.base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        // A literal "+" in a query value decodes server-side as a space, which
        // would turn "+94 77…" into " 94 77…". Escape it before sending.
        comps.percentEncodedQuery = (comps.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
        let (data, _) = try await URLSession.shared.data(from: comps.url!)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// POST application/x-www-form-urlencoded. Returns the final HTTP status.
    /// Every native POST carries `X-App-Source: app` so the server can tag orders
    /// with source="app" (as opposed to source="ecom" for plain web buyers).
    @discardableResult
    static func postForm(_ path: String, fields: [String: String]) async throws -> Int {
        var req = URLRequest(url: API.base.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.setValue("app", forHTTPHeaderField: "X-App-Source")
        var comps = URLComponents(); comps.queryItems = fields.map { URLQueryItem(name: $0.key, value: $0.value) }
        // In x-www-form-urlencoded a literal "+" decodes as a space, so a phone
        // like "+94 77…" would arrive as " 94 77…". Escape it explicitly.
        let encoded = (comps.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
        req.httpBody = encoded.data(using: .utf8)
        let (_, resp) = try await URLSession.shared.data(for: req)
        return (resp as? HTTPURLResponse)?.statusCode ?? 0
    }

    static func postJSON(_ path: String, body: [String: Any]) async {
        var req = URLRequest(url: API.base.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
    }
}

// MARK: - Data-URI image (dish photos are stored as data: URIs)

struct DataImage: View {
    let uri: String
    var body: some View {
        if let img = Self.decode(uri) {
            Image(uiImage: img).resizable().scaledToFill()
        } else {
            ZStack { Color(red: 0.94, green: 0.90, blue: 0.87); Text("🍛").font(.title) }
        }
    }
    static func decode(_ uri: String) -> UIImage? {
        guard uri.hasPrefix("data:"), let comma = uri.firstIndex(of: ",") else { return nil }
        let b64 = String(uri[uri.index(after: comma)...])
        guard let data = Data(base64Encoded: b64) else { return nil }
        return UIImage(data: data)
    }
}

// MARK: - Theme

extension Color {
    static let brandOrange = Color(red: 0.85, green: 0.33, blue: 0.17)   // #d9542b
    static let brandCream  = Color(red: 0.98, green: 0.97, blue: 0.96)   // #faf7f4
    static let brandDark   = Color(red: 0.10, green: 0.08, blue: 0.07)   // #191512
}

// MARK: - Root

struct RootView: View {
    @State private var selectedTab: Int = 0
    // Bumping this key from RootView is the ONLY way to force the Manager
    // WebView back to /app/manager — we do it every time the Manager tab
    // is tapped so tapping it when the WebView has drifted (e.g. via an
    // in-page back link to /app/home) always snaps back.
    @State private var managerReloadKey = UUID()

    private var tabBinding: Binding<Int> {
        Binding(
            get: { selectedTab },
            set: { newTab in
                // If Manager tab is (re)selected — either from another tab
                // OR by tapping it while already there — force a fresh load.
                if newTab == 3 { managerReloadKey = UUID() }
                selectedTab = newTab
            }
        )
    }

    var body: some View {
        TabView(selection: tabBinding) {
            NavigationView { HomeView() }
                .navigationViewStyle(.stack)
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(0)
            NavigationView { OrdersView(selectedTab: $selectedTab) }
                .navigationViewStyle(.stack)
                .tabItem { Label("Orders", systemImage: "bag.fill") }
                .tag(1)
            NavigationView { ShopsMapView() }
                .navigationViewStyle(.stack)
                .tabItem { Label("Map", systemImage: "map.fill") }
                .tag(2)
            NavigationView { ManagerView(reloadKey: managerReloadKey) }
                .navigationViewStyle(.stack)
                .tabItem { Label("Manager", systemImage: "storefront.fill") }
                .tag(3)
            NavigationView { AccountView() }
                .navigationViewStyle(.stack)
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
                .tag(4)
        }
        .accentColor(.brandOrange)
    }
}

// MARK: - Home

struct HomeView: View {
    @State private var home: HomeResponse?
    @State private var query = ""
    @State private var loading = true

    var body: some View {
        List {
            if let home = home {
                if !home.flash.isEmpty && query.isEmpty {
                    Section("Today's specials · අද විශේෂ") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(home.flash) { f in
                                    NavigationLink(destination: ShopView(shopId: f.shopId)) {
                                        FlashCard(item: f)
                                    }.buttonStyle(.plain)
                                }
                            }.padding(.vertical, 4)
                        }
                        .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
                    }
                }
                Section(query.isEmpty ? "Nearby restaurants" : "Results for “\(query)”") {
                    if home.shops.isEmpty {
                        VStack(spacing: 8) {
                            Text("🍛").font(.largeTitle)
                            Text(query.isEmpty ? "No restaurants near you yet" : "Nothing found — try a dish like “kottu” or a city")
                                .font(.subheadline).foregroundColor(.secondary)
                        }.frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    ForEach(home.shops) { s in
                        NavigationLink(destination: ShopView(shopId: s.id)) {
                            ShopRow(shop: s)
                        }
                    }
                }
            } else if loading {
                HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 30)
            } else {
                Text("Couldn't load — pull to retry").foregroundColor(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("3una 5aha · තුන පහ")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Search dishes, shops…")
        .onChange(of: query) { _ in Task { await load() } }
        .refreshable { await load() }
        .task { await load() }
    }

    func load() async {
        do {
            home = try await Net.getQuery("/app/api/home", query: query.isEmpty ? [:] : ["q": query], as: HomeResponse.self)
        } catch { home = nil }
        loading = false
    }
}

struct FlashCard: View {
    let item: FlashItem
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DataImage(uri: item.photo)
                .frame(width: 210, height: 110).clipped()
            VStack(alignment: .leading, spacing: 3) {
                Text(item.tag.uppercased())
                    .font(.system(size: 10, weight: .heavy))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color.brandOrange).foregroundColor(.white)
                    .clipShape(Capsule())
                Text(item.name).font(.subheadline.weight(.bold)).lineLimit(1)
                Text("\(item.shop) · \(item.window)").font(.caption).foregroundColor(.secondary).lineLimit(1)
                HStack(spacing: 6) {
                    Text(API.money(item.price)).font(.caption.weight(.bold)).foregroundColor(.brandOrange)
                    if !item.deal.isEmpty {
                        Text(item.deal).font(.system(size: 10, weight: .heavy))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.brandOrange.opacity(0.15)).foregroundColor(.brandOrange)
                            .clipShape(Capsule())
                    }
                }
            }.padding(10)
        }
        .frame(width: 210)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.brandOrange.opacity(0.35)))
    }
}

struct ShopRow: View {
    let shop: ShopSummary
    @State private var slideIndex = 0
    private var slides: [String] {
        [shop.logo, shop.frontPhoto ?? "", shop.photo2 ?? "", shop.photo3 ?? ""].filter { !$0.isEmpty }
    }
    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                ForEach(Array(slides.enumerated()), id: \.offset) { idx, uri in
                    DataImage(uri: uri)
                        .frame(width: 92, height: 92)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .opacity(idx == slideIndex ? 1 : 0)
                        .animation(.easeInOut(duration: 1.2), value: slideIndex)
                }
            }
            .frame(width: 92, height: 92)
            .onAppear {
                guard slides.count > 1 else { return }
                Timer.scheduledTimer(withTimeInterval: 3.5, repeats: true) { _ in
                    slideIndex = (slideIndex + 1) % slides.count
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(shop.name).font(.subheadline.weight(.bold)).lineLimit(1)
                    if !shop.deal.isEmpty {
                        Text(shop.deal).font(.system(size: 10, weight: .heavy))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.brandOrange).foregroundColor(.white).clipShape(Capsule())
                    }
                }
                Text("★ \(String(format: "%.1f", shop.rating)) · \(shop.city) · \(shop.dishes) dishes")
                    .font(.caption).foregroundColor(.secondary)
                Text(shop.open ? "Open now" : "Closed now")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(shop.open ? .green : .red)
            }
        }
    }
}

// MARK: - Shop detail + basket + native ordering

struct BasketLine: Identifiable {
    let id: String
    let name: String
    let price: Int
    var qty: Int
}

struct ShopView: View {
    let shopId: String
    @State private var detail: ShopDetailResponse?
    @State private var basket: [BasketLine] = []
    @State private var showOrderSheet = false
    @State private var orderPlaced = false
    @State private var selectedCategory: String = "All"
    @State private var selectedMeal: String = "All day"
    // Pre-booking: when the buyer wants the food ready. Defaults to now.
    @State private var wantAt: Date = Date()

    // Same POS ordering, plus "All" as the first chip.
    static let posCategories = ["All", "Starters", "Bites", "Vegi meals", "Chicken", "Beef", "Mutton", "Pork", "Sea food", "Drinks", "Desserts"]
    static let mealTabs = ["All day", "Breakfast", "Lunch", "Dinner"]

    var total: Int { basket.reduce(0) { $0 + $1.price * $1.qty } }

    func matchesMeal(_ d: Dish) -> Bool {
        selectedMeal == "All day" || (d.meals ?? []).contains(selectedMeal)
    }

    /// Category counts respect the active meal so the numbers stay truthful.
    func categoryCount(_ cat: String, in dishes: [Dish]) -> Int {
        dishes.filter { matchesMeal($0) && (cat == "All" || ($0.category ?? "") == cat) }.count
    }

    func mealCount(_ meal: String, in dishes: [Dish]) -> Int {
        meal == "All day" ? dishes.count : dishes.filter { ($0.meals ?? []).contains(meal) }.count
    }

    func filtered(_ dishes: [Dish]) -> [Dish] {
        dishes.filter { matchesMeal($0) && (selectedCategory == "All" || ($0.category ?? "") == selectedCategory) }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            List {
                if let d = detail {
                    // Hero image — edge-to-edge, extends under the nav bar (safe area).
                    Section {
                        DataImage(uri: d.shop.frontPhoto.isEmpty ? d.shop.logo : d.shop.frontPhoto)
                            .frame(height: 260).frame(maxWidth: .infinity).clipped()
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .padding(.top, -100)
                    }
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(d.shop.name).font(.title3.weight(.bold))
                            Text("★ 4.8 · \(d.shop.city), \(d.shop.country) · \(d.shop.open ? "open now" : "closed now")")
                                .font(.caption).foregroundColor(.secondary)
                            // Meal window sits above the categories and is 5%
                            // larger — it's the coarser filter buyers pick first.
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(Self.mealTabs, id: \.self) { meal in
                                        let count = mealCount(meal, in: d.dishes)
                                        Button { selectedMeal = meal } label: {
                                            HStack(spacing: 3) {
                                                Text(meal).font(.system(size: 12.6, weight: .bold))
                                                Text("· \(count)").font(.system(size: 11.6)).opacity(0.7)
                                            }
                                            .padding(.horizontal, 11).padding(.vertical, 6)
                                            .background(selectedMeal == meal ? Color.brandDark : Color(UIColor.secondarySystemGroupedBackground))
                                            .foregroundColor(selectedMeal == meal ? .white : .primary)
                                            .clipShape(Capsule())
                                            .overlay(Capsule().stroke(Color.gray.opacity(0.25), lineWidth: 1))
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.vertical, 1)
                            }
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 5)], alignment: .leading, spacing: 5) {
                                ForEach(Self.posCategories, id: \.self) { cat in
                                    let count = categoryCount(cat, in: d.dishes)
                                    Button { selectedCategory = cat } label: {
                                        HStack(spacing: 3) {
                                            Text(cat).font(.system(size: 12, weight: .semibold))
                                            Text("· \(count)").font(.system(size: 11)).opacity(0.7)
                                        }
                                        .frame(maxWidth: .infinity)
                                        .padding(.horizontal, 8).padding(.vertical, 6)
                                        .background(selectedCategory == cat ? Color.brandDark : Color(UIColor.secondarySystemGroupedBackground))
                                        .foregroundColor(selectedCategory == cat ? .white : .primary)
                                        .clipShape(Capsule())
                                        .overlay(Capsule().stroke(Color.gray.opacity(0.25), lineWidth: 1))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.top, 2)
                        }
                        .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                        .listRowSeparator(.hidden)
                    }
                    Section {
                        // Merge special into the main list (special first, tagged) so
                        // there's a single filterable list — no separate "Today's special" section.
                        let full: [(Dish, String?)] = {
                            var arr: [(Dish, String?)] = []
                            if let sp = d.special, matchesMeal(sp),
                               selectedCategory == "All" || (sp.category ?? "") == selectedCategory {
                                arr.append((sp, sp.tag ?? "Today special"))
                            }
                            arr.append(contentsOf: filtered(d.dishes).map { ($0, nil) })
                            return arr
                        }()
                        if full.isEmpty {
                            Text("No dishes in this category.").foregroundColor(.secondary)
                        } else {
                            // Row 1: first two tiles + BILL panel on the right (all same height).
                            // Rows 2+: 2-col grid using the FULL width — no middle white bar.
                            VStack(spacing: 8) {
                                HStack(alignment: .top, spacing: 6) {
                                    ForEach(Array(full.prefix(2).enumerated()), id: \.offset) { _, pair in
                                        DishTile(dish: pair.0, tag: pair.1, inBasket: basket.first(where: { $0.id == pair.0.id })?.qty ?? 0) { add(pair.0) }
                                            .frame(maxWidth: .infinity)
                                    }
                                    CartPanel(basket: $basket, total: total, wantAt: $wantAt, onCheckout: { showOrderSheet = true })
                                        .frame(width: 100)
                                }
                                if full.count > 2 {
                                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 8) {
                                        ForEach(Array(full.dropFirst(2).enumerated()), id: \.offset) { _, pair in
                                            DishTile(dish: pair.0, tag: pair.1, inBasket: basket.first(where: { $0.id == pair.0.id })?.qty ?? 0) { add(pair.0) }
                                        }
                                    }
                                }
                            }
                            .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 4, trailing: 6))
                            .listRowSeparator(.hidden)
                        }
                    }
                    Section {
                        Link("⚑ Report this shop", destination: API.base.appendingPathComponent("/app/report"))
                            .font(.footnote).foregroundColor(.secondary)
                    }
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 30)
                }
            }
            .listStyle(.plain)
            .environment(\.defaultMinListHeaderHeight, 0)

            if !basket.isEmpty {
                Button { showOrderSheet = true } label: {
                    HStack {
                        Text("View basket · \(basket.reduce(0) { $0 + $1.qty }) item(s)")
                        Spacer()
                        Text(API.money(total))
                    }
                    .font(.subheadline.weight(.bold))
                    .padding().background(Color.brandDark).foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal, 14).padding(.bottom, 8)
                }
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showOrderSheet) {
            OrderSheet(shopId: shopId, basket: $basket, placed: $orderPlaced, wantAt: wantAt)
        }
        .alert("Order placed 🎉", isPresented: $orderPlaced) {
            Button("OK") { }
        } message: {
            Text("The kitchen has your pickup order. Track it in the Orders tab.")
        }
        .task {
            detail = try? await Net.get("/app/api/shop/\(shopId)", as: ShopDetailResponse.self)
        }
    }

    func add(_ d: Dish) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if let i = basket.firstIndex(where: { $0.id == d.id }) { basket[i].qty += 1 }
        else { basket.append(BasketLine(id: d.id, name: d.name, price: d.price, qty: 1)) }
    }
}

struct DishRow: View {
    let dish: Dish
    let tag: String?
    let onAdd: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            DataImage(uri: dish.photo)
                .frame(width: 62, height: 62).clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 2) {
                if let tag = tag {
                    Text(tag.uppercased()).font(.system(size: 9, weight: .heavy))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.brandOrange).foregroundColor(.white).clipShape(Capsule())
                }
                Text(dish.name).font(.subheadline.weight(.semibold))
                Text("Available \(dish.window)").font(.caption).foregroundColor(.secondary)
                HStack(spacing: 6) {
                    Text(API.money(dish.price)).font(.caption.weight(.bold))
                    if !dish.discount.isEmpty {
                        Text(dish.discount).font(.system(size: 10, weight: .heavy)).foregroundColor(.brandOrange)
                    }
                }
            }
            Spacer()
            Button(action: onAdd) {
                Image(systemName: "plus")
                    .font(.subheadline.weight(.bold))
                    .frame(width: 34, height: 34)
                    .background(Color.brandOrange).foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }.buttonStyle(.plain)
        }
    }
}

struct DishTile: View {
    let dish: Dish
    let tag: String?
    let inBasket: Int
    let onAdd: () -> Void
    var body: some View {
        Button(action: onAdd) {
            VStack(alignment: .leading, spacing: 3) {
                ZStack(alignment: .topLeading) {
                    DataImage(uri: dish.photo)
                        .frame(height: 130).frame(maxWidth: .infinity)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    if let tag = tag {
                        Text(tag.uppercased()).font(.system(size: 8, weight: .heavy))
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.brandOrange).foregroundColor(.white)
                            .clipShape(Capsule())
                            .padding(4)
                    }
                    if inBasket > 0 {
                        Text("×\(inBasket)").font(.system(size: 10, weight: .heavy))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.brandDark).foregroundColor(.white)
                            .clipShape(Capsule())
                            .padding(4)
                            .frame(maxWidth: .infinity, alignment: .topTrailing)
                    }
                }
                Text(dishDisplayName(dish.name))
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(2).multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, minHeight: 34, alignment: .topLeading)
                Text(API.money(dish.price))
                    .font(.system(size: 11.5, weight: .bold))
                    .foregroundColor(.brandOrange)
            }
            .padding(7)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(Color(UIColor.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
    private func dishDisplayName(_ n: String) -> String {
        let s = n.replacingOccurrences(of: "Ceylon ", with: "", options: [.caseInsensitive, .anchored])
        return s.trimmingCharacters(in: .whitespaces).isEmpty ? n : s
    }
}

struct CartPanel: View {
    @Binding var basket: [BasketLine]
    let total: Int
    @Binding var wantAt: Date
    let onCheckout: () -> Void
    @State private var showWantPicker = false
    static let wantShort: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "MMM d · h:mm a"; return f
    }()
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("BILL").font(.system(size: 8, weight: .heavy)).opacity(0.65)
            Text(API.money(total))
                .font(.system(size: 11, weight: .heavy))
                .foregroundColor(Color(red: 1.0, green: 0.69, blue: 0.56))
                .minimumScaleFactor(0.7).lineLimit(2)
            Text("\(basket.reduce(0) { $0 + $1.qty }) item\(basket.reduce(0) { $0 + $1.qty } == 1 ? "" : "s")")
                .font(.system(size: 8.5)).opacity(0.6)
            Divider().background(Color.white.opacity(0.15)).padding(.vertical, 2)
            if basket.isEmpty {
                Text("tap a dish").font(.system(size: 10)).opacity(0.5).padding(.vertical, 6)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(basket) { line in
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 3) {
                                    Text(line.name).font(.system(size: 9.5, weight: .semibold)).lineLimit(1)
                                    Spacer(minLength: 2)
                                    Button {
                                        if let i = basket.firstIndex(where: { $0.id == line.id }) {
                                            basket[i].qty -= 1
                                            if basket[i].qty <= 0 { basket.remove(at: i) }
                                        }
                                    } label: {
                                        Image(systemName: "minus.circle.fill")
                                            .font(.system(size: 13)).foregroundColor(.red.opacity(0.8))
                                    }.buttonStyle(.plain)
                                }
                                HStack {
                                    Text("×\(line.qty)").font(.system(size: 9)).opacity(0.6)
                                    Spacer()
                                    Text(API.money(line.price * line.qty))
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundColor(Color(red: 1.0, green: 0.69, blue: 0.56))
                                }
                            }
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
            // When the buyer wants the food ready — defaults to now.
            // Tap to open a picker sheet; the chosen date+time rides the
            // order to POS so the clerk sees pre-booking timing on the card.
            VStack(alignment: .leading, spacing: 2) {
                Text("WANT AT").font(.system(size: 8, weight: .heavy)).opacity(0.55)
                Button { showWantPicker = true } label: {
                    Text(Self.wantShort.string(from: wantAt))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 6).padding(.vertical, 5)
                        .background(Color.white.opacity(0.10))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }.buttonStyle(.plain)
            }
            .padding(.vertical, 4)
            .sheet(isPresented: $showWantPicker) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Want the food at").font(.headline)
                    DatePicker("", selection: $wantAt, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                        .datePickerStyle(.graphical).labelsHidden()
                    Button("Done") { showWantPicker = false }
                        .frame(maxWidth: .infinity).padding().background(Color.brandOrange)
                        .foregroundColor(.white).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .padding()
            }
            // Check out button always visible; disabled when the basket is empty.
            Button(action: onCheckout) {
                Text("Check out").font(.system(size: 11, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(basket.isEmpty ? Color.white.opacity(0.15) : Color.brandOrange)
                    .foregroundColor(basket.isEmpty ? .white.opacity(0.4) : .white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .disabled(basket.isEmpty)
        }
        .padding(8)
        .background(Color.brandDark)
        .foregroundColor(.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct OrderSheet: View {
    let shopId: String
    @Binding var basket: [BasketLine]
    @Binding var placed: Bool
    let wantAt: Date
    @Environment(\.dismiss) private var dismiss
    @AppStorage("buyerName") private var buyerName = ""
    @AppStorage("buyerPhone") private var buyerPhone = ""
    @State private var sending = false
    @State private var failed = false
    static let wantFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "MMM d · h:mm a"; return f
    }()

    var total: Int { basket.reduce(0) { $0 + $1.price * $1.qty } }

    var body: some View {
        NavigationView {
            Form {
                Section("Your basket") {
                    ForEach($basket) { $line in
                        HStack {
                            Text(line.name).font(.subheadline)
                            Spacer()
                            Stepper("\(line.qty)", value: $line.qty, in: 1...50).labelsHidden()
                            Text("×\(line.qty)").font(.subheadline.weight(.bold)).frame(width: 34)
                        }
                    }
                    .onDelete { basket.remove(atOffsets: $0) }
                    HStack { Text("Total").bold(); Spacer(); Text(API.money(total)).bold() }
                }
                Section("Pickup details") {
                    TextField("Your name", text: $buyerName)
                    TextField("Phone (e.g. +94 77 123 4567)", text: $buyerPhone).keyboardType(.phonePad)
                    HStack {
                        Text("Want at").foregroundColor(.secondary)
                        Spacer()
                        Text(Self.wantFormatter.string(from: wantAt)).font(.subheadline.weight(.semibold))
                    }
                }
                if failed { Text("Couldn't place the order — check your connection and try again.").foregroundColor(.red).font(.footnote) }
                Button(sending ? "Placing order…" : "Place pickup order · \(API.money(total))") {
                    Task { await place() }
                }
                .disabled(sending || basket.isEmpty || buyerName.isEmpty || buyerPhone.count < 7)
                .font(.headline)
            }
            .navigationTitle("Confirm order")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    func place() async {
        sending = true; failed = false
        let items = basket.map { ["name": $0.name, "qty": $0.qty, "price": $0.price] }
        let itemsJSON = (try? JSONSerialization.data(withJSONObject: items)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        do {
            let iso = ISO8601DateFormatter().string(from: wantAt)
            let status = try await Net.postForm("/app/order", fields: [
                "shopId": shopId, "items": itemsJSON,
                "buyer": buyerName, "phone": buyerPhone.filter { "0123456789+".contains($0) },
                "pickupAt": Self.wantFormatter.string(from: wantAt),
                "wantAt": iso,
            ])
            if (200...399).contains(status) {
                basket = []
                PushRegistrar.shared.register()   // now the server knows this phone
                dismiss()
                placed = true
            } else { failed = true }
        } catch { failed = true }
        sending = false
    }
}

// MARK: - Orders

struct OrdersView: View {
    /// Orders is a root tab, so there's no navigation stack to pop — the round
    /// back button switches the TabView back to Home instead.
    @Binding var selectedTab: Int
    @AppStorage("buyerPhone") private var buyerPhone = ""
    @State private var orders: [OrderSummary] = []
    @State private var loaded = false

    var body: some View {
        List {
            if orders.isEmpty && loaded {
                VStack(spacing: 8) {
                    Text("🧾").font(.largeTitle)
                    Text(buyerPhone.isEmpty ? "Place your first pickup order from a shop on Home." : "No orders yet for \(buyerPhone).")
                        .font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity).padding(.vertical, 24)
            }
            ForEach(orders) { o in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(o.shop).font(.subheadline.weight(.bold))
                        Spacer()
                        Text(statusLabel(o.status))
                            .font(.system(size: 11, weight: .heavy))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(badge(o.status).opacity(0.18))
                            .foregroundColor(badge(o.status))
                            .clipShape(Capsule())
                    }
                    ForEach(Array(o.items.enumerated()), id: \.offset) { _, it in
                        Text("\(it.qty)× \(it.name)").font(.caption).foregroundColor(.secondary)
                    }
                    Text("\(API.money(o.total)) · pickup \(o.pickupAt)").font(.caption.weight(.semibold))
                }
                .padding(10)
                // Border tracks the order's journey: grey placed → orange cooking
                // → green ready → blue out for delivery.
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(badge(o.status), lineWidth: o.status == "pending_review" || o.status == "pending" ? 1.5 : 2.5)
                )
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("My orders")
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button { selectedTab = 0 } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.primary)
                        .frame(width: 34, height: 34)
                        .background(Color(UIColor.secondarySystemGroupedBackground))
                        .clipShape(Circle())
                        .shadow(color: .black.opacity(0.08), radius: 3, y: 1)
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    /// Buyer-facing wording for each pipeline stage.
    func statusLabel(_ s: String) -> String {
        switch s {
        case "pending_review": return "Order placed"
        case "pending":        return "In kitchen"
        case "preparing":      return "Cooking"
        case "done":           return "Ready"
        case "delivered":      return "Delivered"
        case "on_hold":        return "On hold"
        default:               return s.capitalized
        }
    }

    /// Border + badge colour per stage — white/grey while placed, orange while
    /// the kitchen cooks, green once ready, blue when out for delivery.
    func badge(_ s: String) -> Color {
        switch s {
        case "preparing": return .orange
        case "done":      return .green
        case "delivered": return .blue
        case "on_hold":   return .gray
        default:          return Color(UIColor.systemGray3)   // placed / in kitchen
        }
    }

    func load() async {
        if !buyerPhone.isEmpty {
            let cleaned = buyerPhone.filter { "0123456789+".contains($0) }
            orders = (try? await Net.getQuery("/app/api/orders", query: ["phone": cleaned], as: OrdersResponse.self))?.orders ?? []
        }
        loaded = true
    }
}

// MARK: - Map (native MapKit)

struct ShopPin: Identifiable {
    let id: String
    let name: String
    let coord: CLLocationCoordinate2D
}

struct ShopsMapView: View {
    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 6.9271, longitude: 79.8612),
        span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12))
    @State private var pins: [ShopPin] = []
    @State private var selected: ShopPin?
    @State private var locationManager = CLLocationManager()

    var body: some View {
        ZStack(alignment: .bottom) {
            Map(coordinateRegion: $region, showsUserLocation: true, annotationItems: pins) { pin in
                MapAnnotation(coordinate: pin.coord) {
                    Button { selected = pin } label: {
                        VStack(spacing: 2) {
                            Image(systemName: "fork.knife.circle.fill")
                                .font(.title).foregroundColor(.brandOrange)
                                .background(Circle().fill(Color.white))
                            Text(pin.name).font(.system(size: 10, weight: .bold))
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Color.white.opacity(0.9)).clipShape(Capsule())
                        }
                    }
                }
            }
            .ignoresSafeArea(edges: .bottom)

            if let sel = selected {
                NavigationLink(destination: ShopView(shopId: sel.id)) {
                    HStack {
                        Text(sel.name).font(.subheadline.weight(.bold))
                        Spacer()
                        Text("Open shop ›")
                    }
                    .padding().background(Color(UIColor.secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .padding(14)
                }.buttonStyle(.plain)
            }
        }
        .navigationTitle("Sri Lankan food nearby")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let home = try? await Net.get("/app/api/home", as: HomeResponse.self)
            pins = (home?.shops ?? []).compactMap { s in
                guard let lat = s.lat, let lng = s.lng else { return nil }
                return ShopPin(id: s.id, name: s.name, coord: CLLocationCoordinate2D(latitude: lat, longitude: lng))
            }
            if let first = pins.first { region.center = first.coord }
            locationManager.requestWhenInUseAuthorization()
        }
    }
}

// MARK: - Account (native Sign in with Apple + web flows)

struct AccountView: View {
    @AppStorage("signedInEmail") private var signedInEmail = ""
    @AppStorage("signedInProvider") private var signedInProvider = ""
    @State private var webURL: IdentifiedURL?

    /// Refresh sign-in state from the WKWebView cookie jar (where web sign-in
    /// actually stores cookies). Any web sign-in (Email / SMS / Guest) sets
    /// `app_email` + `app_user`; we mirror that into @AppStorage so this view
    /// knows the user is in.
    private func refreshFromCookies() {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            let ours = cookies.filter { $0.domain.contains("railway.app") || $0.domain.contains("web-production") }
            let email = ours.first(where: { $0.name == "app_email" })?.value.removingPercentEncoding
            let provider = ours.first(where: { $0.name == "app_user" })?.value
            DispatchQueue.main.async {
                if let email = email, !email.isEmpty {
                    signedInEmail = email
                    signedInProvider = provider ?? signedInProvider
                }
            }
        }
    }

    private func providerLabel(_ p: String) -> String {
        switch p {
        case "apple": return "Apple"
        case "google": return "Google"
        case "email": return "email"
        case "sms": return "SMS"
        case "guest": return "Guest"
        default: return "your account"
        }
    }

    var body: some View {
        list
    }

    @ViewBuilder
    private var list: some View {
        if #available(iOS 17.0, *) {
            listBody.listSectionSpacing(6)
        } else {
            listBody
        }
    }

    private var listBody: some View {
        List {
            Section {
                if signedInEmail.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Sign in to sync favourites & orders. Browsing works without an account.")
                            .font(.caption2).foregroundColor(.secondary)
                        // 2×2 grid — matches the web welcome page (Apple · Email · SMS · Guest)
                        HStack(spacing: 6) {
                            SignInWithAppleButton(.signIn) { req in
                                req.requestedScopes = [.email, .fullName]
                            } onCompletion: { result in
                                Task { await handleApple(result) }
                            }
                            .frame(height: 40)
                            .signInWithAppleButtonStyle(.black)
                            webSignInButton("✉︎  Email", path: "/app")
                        }
                        HStack(spacing: 6) {
                            webSignInButton("💬  SMS", path: "/app")
                            webSignInButton("👀  Guest", path: "/app")
                        }
                    }.padding(.vertical, 2)
                } else {
                    HStack {
                        Image(systemName: "checkmark.seal.fill").foregroundColor(.green)
                        VStack(alignment: .leading) {
                            Text("Signed in with \(providerLabel(signedInProvider))")
                                .font(.subheadline.weight(.semibold))
                            Text(signedInEmail).font(.caption).foregroundColor(.secondary)
                        }
                        Spacer()
                        Button("Sign out") {
                            signedInEmail = ""; signedInProvider = ""
                            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
                                for c in cookies where c.domain.contains("railway.app") || c.domain.contains("web-production") {
                                    WKWebsiteDataStore.default().httpCookieStore.delete(c)
                                }
                            }
                        }.font(.caption)
                    }
                }
            }
            // Shop owners jump straight to the management hub from here;
            // the same is always available from the Manager tab below.
            if !signedInEmail.isEmpty {
                Section {
                    Button {
                        webURL = IdentifiedURL(url: API.base.appendingPathComponent("/app/manager"), title: "Shop Manager")
                    } label: {
                        HStack {
                            Image(systemName: "storefront.fill")
                            Text("Shop Manager").font(.headline)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundColor(.secondary)
                        }
                        .foregroundColor(.red)
                    }
                }
            }
            Section("My account") {
                row("person.crop.circle", "My profile & favourites", "/app/profile")
                row("bell.badge", "Notifications", nil, note: "Order updates arrive as push notifications.")
            }
            // Shop is handled by the Manager tab + the red button above —
            // no separate "open your shop" row here (was redundant).
            Section("About") {
                row("questionmark.circle", "Support & contact", "/app/support")
                row("doc.text", "Terms of Service", "/app/terms")
                row("hand.raised", "Privacy Policy", "/app/privacy")
            }
            Section {
                Text("3una 5aha is a non-commercial community app — free listings, no fees, no commission.\nPublished by GGMT PTE. LTD. · www.ggmt.sg")
                    .font(.caption2).foregroundColor(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $webURL, onDismiss: { refreshFromCookies() }) { u in WebSheet(url: u.url, title: u.title) }
        .onAppear { refreshFromCookies() }
    }

    @ViewBuilder
    func webSignInButton(_ label: String, path: String) -> some View {
        Button {
            webURL = IdentifiedURL(url: API.base.appendingPathComponent(path), title: "Sign in")
        } label: {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 40)
                .foregroundColor(.primary)
                .background(Color(UIColor.systemBackground))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color(UIColor.separator)))
                .clipShape(RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    func row(_ icon: String, _ label: String, _ path: String?, note: String? = nil) -> some View {
        if let path = path {
            Button {
                webURL = IdentifiedURL(url: API.base.appendingPathComponent(path), title: label)
            } label: {
                Label(label, systemImage: icon)
            }.foregroundColor(.primary)
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Label(label, systemImage: icon)
                if let note = note { Text(note).font(.caption2).foregroundColor(.secondary) }
            }
        }
    }

    func handleApple(_ result: Result<ASAuthorization, Error>) async {
        guard case .success(let auth) = result,
              let cred = auth.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8) else { return }
        var fields = ["id_token": idToken]
        if let email = cred.email { fields["email"] = email }
        let name = [cred.fullName?.givenName, cred.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
        if !name.isEmpty { fields["name"] = name }
        if let status = try? await Net.postForm("/app/auth/apple", fields: fields), status == 200 {
            signedInEmail = cred.email ?? "Apple ID"
            signedInProvider = "apple"
        }
    }
}

struct IdentifiedURL: Identifiable {
    let url: URL
    let title: String
    var id: String { url.absoluteString }
}

// MARK: - WebSheet (secondary flows keep the existing web experience)

struct WebSheet: View {
    let url: URL
    let title: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationView {
            WebViewRepresentable(url: url)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
    }
}

// MARK: - Shop Manager (owner hub — webview-backed)
// The /app/manager route resolves the signed-in owner's shop from the
// session cookie and shows the owner hub (menu, kitchen stock, purchase
// planner, etc.). Non-owners see an "open your shop" prompt.

struct ManagerView: View {
    // Driven from RootView so we can bump it every time the Manager tab is
    // (re)selected — the WebView snaps back to /app/manager on every tap,
    // regardless of where in-page navigation drifted it to.
    let reloadKey: UUID
    var body: some View {
        WebViewRepresentable(url: API.base.appendingPathComponent("/app/manager"), reloadKey: reloadKey)
            .navigationBarHidden(true)
            .ignoresSafeArea(.container, edges: .bottom)
    }
}

/// Appends `?native=1` to the URL so the server-rendered page can hide its
/// own `.nav` bar (the native TabView already provides one — see shell.js).
private func nativeURL(_ url: URL) -> URL {
    var comps = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    var items = comps.queryItems ?? []
    if !items.contains(where: { $0.name == "native" }) {
        items.append(URLQueryItem(name: "native", value: "1"))
    }
    comps.queryItems = items
    return comps.url ?? url
}

struct WebViewRepresentable: UIViewRepresentable {
    let url: URL
    var reloadKey: UUID? = nil

    func makeCoordinator() -> Coordinator { Coordinator() }
    class Coordinator {
        // Remember the reloadKey we've already applied so we can force a
        // reload ONLY when the parent view intentionally bumps it (e.g. a
        // tab-appear), not on every SwiftUI recompute.
        var lastReloadKey: UUID?
    }

    func makeUIView(context: Context) -> WKWebView {
        let web = WKWebView()
        // Share the native session (e.g. Apple sign-in cookie) with the web pages.
        let cookies = HTTPCookieStorage.shared.cookies(for: API.base) ?? []
        let store = web.configuration.websiteDataStore.httpCookieStore
        let group = DispatchGroup()
        for c in cookies { group.enter(); store.setCookie(c) { group.leave() } }
        // A 'native=1' cookie so the server-rendered page can hide its own
        // .nav bar. Cookies survive redirects (unlike the ?native=1 query
        // param) and every same-origin request carries it, so any page the
        // WebView lands on knows it's inside the native app.
        if let host = API.base.host, let native = HTTPCookie(properties: [
            .domain: host, .path: "/", .name: "native", .value: "1",
        ]) {
            group.enter(); store.setCookie(native) { group.leave() }
        }
        let target = nativeURL(url)
        group.notify(queue: .main) { web.load(URLRequest(url: target)) }
        context.coordinator.lastReloadKey = reloadKey
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Only force the initial URL back when reloadKey CHANGES. Reloading
        // whenever uiView.url != target was too aggressive — every SwiftUI
        // recompute (which happens for many reasons unrelated to navigation)
        // would kick the user out of any sub-page they navigated to inside
        // the WebView, and that looked like being logged out.
        if let key = reloadKey, key != context.coordinator.lastReloadKey {
            context.coordinator.lastReloadKey = key
            uiView.load(URLRequest(url: nativeURL(url)))
        }
    }
}

// MARK: - Push registration (native, no web bridge needed)

final class PushRegistrar: NSObject {
    static let shared = PushRegistrar()
    private var lastToken: String?

    func requestAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didReceive(tokenData: Data) {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        lastToken = token
        send(token)
    }

    /// Re-send the last token (e.g. after an order stores the buyer phone cookie).
    func register() {
        if let t = lastToken { send(t) }
    }

    private func send(_ token: String) {
        Task { await Net.postJSON("/app/push/register", body: ["token": token, "platform": "ios"]) }
    }
}
