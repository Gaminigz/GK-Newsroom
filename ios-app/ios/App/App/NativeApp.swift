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
        let (data, _) = try await URLSession.shared.data(from: comps.url!)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// POST application/x-www-form-urlencoded. Returns the final HTTP status.
    @discardableResult
    static func postForm(_ path: String, fields: [String: String]) async throws -> Int {
        var req = URLRequest(url: API.base.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var comps = URLComponents(); comps.queryItems = fields.map { URLQueryItem(name: $0.key, value: $0.value) }
        req.httpBody = (comps.percentEncodedQuery ?? "").data(using: .utf8)
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
    var body: some View {
        TabView {
            NavigationView { HomeView() }
                .navigationViewStyle(.stack)
                .tabItem { Label("Home", systemImage: "house.fill") }
            NavigationView { OrdersView() }
                .navigationViewStyle(.stack)
                .tabItem { Label("Orders", systemImage: "bag.fill") }
            NavigationView { ShopsMapView() }
                .navigationViewStyle(.stack)
                .tabItem { Label("Map", systemImage: "map.fill") }
            NavigationView { AccountView() }
                .navigationViewStyle(.stack)
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
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
    var body: some View {
        HStack(spacing: 12) {
            DataImage(uri: shop.logo)
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 12))
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

    var total: Int { basket.reduce(0) { $0 + $1.price * $1.qty } }

    var body: some View {
        ZStack(alignment: .bottom) {
            List {
                if let d = detail {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            DataImage(uri: d.shop.frontPhoto.isEmpty ? d.shop.logo : d.shop.frontPhoto)
                                .frame(height: 150).frame(maxWidth: .infinity).clipped()
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                            Text(d.shop.name).font(.title3.weight(.bold))
                            Text("★ 4.8 · \(d.shop.city), \(d.shop.country) · \(d.shop.open ? "open now" : "closed now")")
                                .font(.caption).foregroundColor(.secondary)
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                        .listRowSeparator(.hidden)
                    }
                    if let sp = d.special {
                        Section("Today's special · අද විශේෂ") {
                            DishRow(dish: sp, tag: sp.tag ?? "Today special") { add(sp) }
                        }
                    }
                    Section("Popular dishes") {
                        if d.dishes.isEmpty { Text("No dishes published yet.").foregroundColor(.secondary) }
                        ForEach(d.dishes) { dish in
                            DishRow(dish: dish, tag: nil) { add(dish) }
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
            .listStyle(.insetGrouped)

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
        .navigationTitle(detail?.shop.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showOrderSheet) {
            OrderSheet(shopId: shopId, basket: $basket, placed: $orderPlaced)
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

struct OrderSheet: View {
    let shopId: String
    @Binding var basket: [BasketLine]
    @Binding var placed: Bool
    @Environment(\.dismiss) private var dismiss
    @AppStorage("buyerName") private var buyerName = ""
    @AppStorage("buyerPhone") private var buyerPhone = ""
    @State private var pickupAt = "7:00 PM"
    @State private var sending = false
    @State private var failed = false

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
                    TextField("Pickup time", text: $pickupAt)
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
            let status = try await Net.postForm("/app/order", fields: [
                "shopId": shopId, "items": itemsJSON,
                "buyer": buyerName, "phone": buyerPhone.filter { "0123456789+".contains($0) },
                "pickupAt": pickupAt,
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
                        Text(o.status.capitalized)
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
                }.padding(.vertical, 2)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("My orders")
        .refreshable { await load() }
        .task { await load() }
    }

    func badge(_ s: String) -> Color {
        switch s { case "done": return .green; case "preparing": return .orange; default: return .brandOrange }
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
            CLLocationManager().requestWhenInUseAuthorization()
        }
    }
}

// MARK: - Account (native Sign in with Apple + web flows)

struct AccountView: View {
    @AppStorage("signedInEmail") private var signedInEmail = ""
    @State private var webURL: IdentifiedURL?

    var body: some View {
        List {
            Section {
                if signedInEmail.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Sign in to sync your favourites and verify your account. Browsing and ordering work without an account too.")
                            .font(.footnote).foregroundColor(.secondary)
                        SignInWithAppleButton(.signIn) { req in
                            req.requestedScopes = [.email, .fullName]
                        } onCompletion: { result in
                            Task { await handleApple(result) }
                        }
                        .frame(height: 46)
                        .signInWithAppleButtonStyle(.black)
                    }.padding(.vertical, 6)
                } else {
                    HStack {
                        Image(systemName: "checkmark.seal.fill").foregroundColor(.green)
                        VStack(alignment: .leading) {
                            Text("Signed in with Apple").font(.subheadline.weight(.semibold))
                            Text(signedInEmail).font(.caption).foregroundColor(.secondary)
                        }
                        Spacer()
                        Button("Sign out") { signedInEmail = "" }.font(.caption)
                    }
                }
            }
            Section("My account") {
                row("person.crop.circle", "My profile & favourites", "/app/profile")
                row("bell.badge", "Notifications", nil, note: "Order updates arrive as push notifications.")
            }
            Section("For restaurants & home cooks") {
                row("storefront", "Open your shop — free", "/app")
            }
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
        .sheet(item: $webURL) { u in WebSheet(url: u.url, title: u.title) }
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

struct WebViewRepresentable: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> WKWebView {
        let web = WKWebView()
        // Share the native session (e.g. Apple sign-in cookie) with the web pages.
        let cookies = HTTPCookieStorage.shared.cookies(for: API.base) ?? []
        let store = web.configuration.websiteDataStore.httpCookieStore
        let group = DispatchGroup()
        for c in cookies { group.enter(); store.setCookie(c) { group.leave() } }
        group.notify(queue: .main) { web.load(URLRequest(url: url)) }
        return web
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
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
