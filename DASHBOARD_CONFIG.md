# Cấu hình dashboard với các khối IoT OhStem

Mỗi trình duyệt lưu một cấu hình riêng. Mở dashboard, nhấn bánh răng cạnh trạng thái kết nối hoặc ở khối **Kết nối**, chọn **OhStem** và nhập username giống khối màu cam “kết nối server OhStem IoT”. Nhấn **Lưu**. Người dùng mới chưa nhập username sẽ không tự kết nối vào một trang trại có sẵn.

ESP32 dùng `mqtt.ohstem.vn:1883`; trình duyệt dùng mẫu `wss://mqtt.ohstem.vn:8084/mqtt`. Với username `user01234`, channel `V1` trong Scratch tương ứng topic `user01234/feeds/V1`. Mật khẩu MQTT trong dashboard không phải mật khẩu WiFi của bo mạch.

## Đổi channel và lệnh điều khiển

- Nhấn bánh răng tại ô cảm biến, thiết bị hoặc khối cần cấu hình. Chọn **Channel theo topic gốc** để nhập `V1`… hoặc **Topic đầy đủ** để nhập địa chỉ chính xác, kể cả topic trần. Kiểm tra dòng **Topic thực tế** trước khi lưu.
- Ô đất A/B, thẻ độ ẩm đất và biểu đồ dùng chung nguồn. Đổi tại một vị trí áp dụng cho các vị trí còn lại.
- Với đèn/bơm/quạt, điền **Lệnh bật / Lệnh tắt** đúng chuỗi mà khối Scratch đang so sánh. Mặc định là `1`/`0`, có thể đổi thành `ON`/`OFF` hoặc chuỗi khác. Cảm biến gửi số, ví dụ `27.5` hoặc `27,5`.
- **Lưu** kiểm tra và áp dụng; **Hủy**, nút đóng hoặc Escape bỏ toàn bộ thay đổi chưa lưu. Nếu lưu thất bại, cấu hình và kết nối trước đó vẫn được giữ.
- Không thể dùng cùng topic cho hai chức năng độc lập. Topic phân biệt chữ hoa/thường, không nhận wildcard `+`/`#` và không tự nghe thêm các kênh trần.
- Ngưỡng bật đèn mặc định dùng V12. Với chương trình Scratch nhận V11, đổi sang V11. Chỉ thêm **kênh phụ tương thích** khi cần chủ động gửi/nhận trên cả hai kênh. Cấu hình v1 được chuyển sang v2 giữ cả V12 và V11 như bản cũ.

Lưu cấu hình MQTT sẽ mở phiên kết nối mới, xóa lệnh chờ và dữ liệu trực tiếp/lịch sử biểu đồ cũ, đồng thời tắt các luật tự động trên web. Người dùng chủ động bật lại luật khi đã nhận dữ liệu từ nguồn mới. Nếu web đang giữ bơm bật, phải tắt bơm qua kết nối cũ trước khi đổi cấu hình. Web không tự thay đổi các khối hoặc nạp lại ESP32.

## Các tính năng Scratch tùy chọn

Chỉ bật các mục tương ứng trong cài đặt khi chương trình có xử lý:

| Tính năng | Giao thức mẫu |
|---|---|
| Kiểm tra kết nối | Web gửi `ARE U HERE`, ESP trả `HERE`, mặc định V10 |
| Yêu cầu đồng bộ | Web gửi `SYNC_REQUEST`, ESP gửi lại các giá trị, mặc định V10 |
| Tưới tự động trên ESP32 | JSON cấu hình V18, JSON phản hồi V19, Unix timestamp theo giây V20 |

Channel của các mục này đều có thể đổi bằng bánh răng. Với chương trình Scratch cơ bản, để chúng tắt: dashboard vẫn nhận cảm biến và gửi lệnh thiết bị, trạng thái kết nối chỉ cho biết MQTT đã kết nối. Chế độ V9 giữ giao thức `0` = ESP tự động, `1` = IoT thủ công. Chi tiết tưới và phản hồi xem [IRRIGATION.md](IRRIGATION.md).

Camera được cấu hình bằng URL HTTP/HTTPS riêng trong bánh răng của khối camera; để trống để dùng mô phỏng. Broker tùy chỉnh phải cung cấp cổng WebSocket cho trình duyệt. Nếu dashboard chạy HTTPS, broker/camera cũng cần giao thức bảo mật tương ứng.

## Kiểm thử

Không cần cài thư viện để chạy kiểm thử JavaScript và firmware giả lập:

```powershell
node --check scripts.js
node --check farm-config.js
node --test tests/dashboard.test.js
python -m unittest discover -s tests -v
```

Kiểm tra trình duyệt bằng `playwright-cli`, dùng MQTT giả lập và dữ liệu kiểm thử trong phiên trình duyệt riêng:

```powershell
python -m http.server 8765 --bind 127.0.0.1
# Mở terminal khác:
playwright-cli -s=farm-config open http://127.0.0.1:8765 --browser=msedge
playwright-cli -s=farm-config --raw run-code --filename=tests/browser-dashboard.js
playwright-cli -s=farm-config close
```

Nghiệm thu trên bo mạch: dùng cùng username ở Scratch và dashboard; gửi một số trên channel cảm biến, đổi channel ở cả hai phía rồi thử lại; nhận lệnh bật/tắt bằng đúng chuỗi đã cấu hình. Thử hai username khác nhau cùng dùng V1 để xác nhận tách dữ liệu. Kiểm tra V10 và V18–V20 riêng khi chương trình đã có các khối xử lý. Bộ kiểm thử trên máy không thay thế kiểm tra relay và ESP32 thực tế.
