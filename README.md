# Dự Án UI - Giao Diện Hệ Thống Quản Lý

## 📋 Mô Tả Dự Án

Đây là dự án giao diện người dùng (UI) cho hệ thống quản lý tổng hợp, bao gồm hai phần chính:
- **Admin**: Giao diện quản trị viên để quản lý hệ thống, người dùng, mô hình và báo cáo
- **User**: Giao diện người dùng để xem lịch sử, phân tích kết quả và các thông tin liên quan

Dự án được xây dựng bằng **HTML5**, **CSS3** và **JavaScript** để tạo nên một ứng dụng web tĩnh với giao diện thân thiện.

## 📁 Cấu Trúc Thư Mục

```
UI/
├── README.md                 # Tài liệu hướng dẫn dự án
├── constants.js              # Các hằng số toàn cục
├── img logo/                 # Thư mục chứa logo
├── Admin/                    # 📊 Giao diện Admin (Quản trị viên)
│   ├── home.html             # Trang chủ Admin
│   ├── user_managerment.html # Quản lý người dùng
│   ├── model.html            # Quản lý mô hình
│   ├── report.html           # Báo cáo
│   ├── result_analysis.html  # Phân tích kết quả
│   └── history.html          # Lịch sử hoạt động
└── User/                     # 👤 Giao diện User (Người dùng)
    ├── index.html            # Trang chủ
    ├── header.html           # Header component
    ├── footer.html           # Footer component
    ├── common.js             # Script dùng chung
    ├── login.html            # Đăng nhập
    ├── register.html         # Đăng ký
    ├── about-us.html         # Giới thiệu
    ├── guide.html            # Hướng dẫn sử dụng
    ├── blog.html             # Công nghệ blog
    ├── list_blog.html        # Danh sách blog
    ├── history.html          # Lịch sử của tôi
    ├── result_analys.html    # Phân tích kết quả
    ├── blank-page.html       # Trang trống
    ├── privacy-policy.html   # Chính sách bảo mật
    └── terms.html            # Điều khoản dịch vụ
```

## ✨ Tính Năng Chính

### 🔐 Admin - Bảng Điều Khiển Quản Trị

| Trang | Chức năng |
|-------|---------|
| **Home** | Tổng quan hệ thống, thống kê chung |
| **User Management** | Thêm, sửa, xóa, quản lý tài khoản người dùng |
| **Model** | Quản lý các mô hình, cấu hình |
| **Report** | Tạo, xem, xuất báo cáo |
| **Result Analysis** | Phân tích chi tiết kết quả hệ thống |
| **History** | Theo dõi lịch sử hoạt động |

### 👥 User - Giao Diện Người Dùng

| Trang | Chức năng |
|-------|---------|
| **Trang Chủ** | Giao diện chính, thông tin tổng hợp |
| **Đăng Nhập/Đăng Ký** | Xác thực người dùng |
| **Hướng Dẫn** | Hướng dẫn sử dụng hệ thống |
| **Blog** | Chia sẻ bài viết công nghệ |
| **Lịch Sử** | Xem lịch sử hoạt động cá nhân |
| **Phân Tích Kết Quả** | Xem và phân tích kết quả của mình |
| **Tài Liệu Pháp Lý** | Chính sách bảo mật, điều khoản |

## 🛠️ Công Nghệ Sử Dụng

- **HTML5** - Cấu trúc và markup
- **CSS3** - Styling, layout responsive
- **JavaScript (ES6+)** - Tương tác, logic ứng dụng
- **Modular Components** - Header, Footer components tái sử dụng

## 🚀 Hướng Dẫn Sử Dụng

### Yêu Cầu
- Trình duyệt web hiện đại (Chrome, Firefox, Safari, Edge)
- Server web local hoặc mở file trực tiếp

### Cài Đặt & Chạy

#### Cách 1: Mở trực tiếp trong trình duyệt
```bash
# Đơn giản nhất - double click file .html hoặc kéo vào trình duyệt
```

#### Cách 2: Sử dụng Live Server (VS Code)
```bash
# 1. Cài đặt extension "Live Server" trong VS Code
# 2. Click chuột phải vào file HTML
# 3. Chọn "Open with Live Server"
```

#### Cách 3: Sử dụng Python server
```bash
# Python 3.x
python -m http.server 8000

# Hoặc Python 2.x
python -m SimpleHTTPServer 8000
```

### Truy Cập
- **Admin**: Mở file tương ứng trong thư mục `Admin/` (ví dụ: `Admin/home.html`)
- **User**: Mở file tương ứng trong thư mục `User/` (ví dụ: `User/index.html`)

## 📝 Ghi Chú Phát Triển

- Sử dụng `constants.js` để lưu các giá trị hằng số toàn cục
- Sử dụng `common.js` để lưu các function dùng chung cho phần User
- Header và Footer được tách thành component riêng để dễ bảo trì
- Các trang được thiết kế responsive để hiển thị tốt trên mọi thiết bị

## 📞 Hỗ Trợ

Nếu gặp vấn đề, vui lòng kiểm tra:
- Đường dẫn file có chính xác không
- Trình duyệt hỗ trợ ES6+ JavaScript
- Server web được cấu hình đúng (nếu dùng)

    