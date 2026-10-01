const draftStorageKey = "kmutnb-application-draft";
const attachmentDatabaseName = "kmutnb-application-files";

function openApplicationFileDatabase() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(attachmentDatabaseName, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains("files")) {
				request.result.createObjectStore("files");
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function storeApplicationFile(key, file) {
	const database = await openApplicationFileDatabase();
	return new Promise((resolve, reject) => {
		const transaction = database.transaction("files", "readwrite");
		transaction.objectStore("files").put(file, key);
		transaction.oncomplete = () => {
			database.close();
			resolve();
		};
		transaction.onerror = () => {
			database.close();
			reject(transaction.error);
		};
		transaction.onabort = () => {
			database.close();
			reject(transaction.error);
		};
	});
}

async function loadApplicationFile(key) {
	const database = await openApplicationFileDatabase();
	return new Promise((resolve, reject) => {
		const transaction = database.transaction("files", "readonly");
		const request = transaction.objectStore("files").get(key);
		request.onsuccess = () => {
			database.close();
			resolve(request.result);
		};
		request.onerror = () => {
			database.close();
			reject(request.error);
		};
	});
}

async function clearApplicationFiles() {
	try {
		const database = await openApplicationFileDatabase();
		await new Promise((resolve, reject) => {
			const transaction = database.transaction("files", "readwrite");
			transaction.objectStore("files").clear();
			transaction.oncomplete = resolve;
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
		database.close();
	} catch {
		return;
	}
}

function renderApplicationFileLink(valueElement, savedFile) {
	if (!savedFile?.attachmentKey) {
		return;
	}

	void loadApplicationFile(savedFile.attachmentKey).then(file => {
		if (!file) {
			return;
		}

		const fileUrl = URL.createObjectURL(file);
		const imageDialog = document.querySelector("#application-image-dialog");
		if (file.type.startsWith("image/") && imageDialog) {
			const previewButton = document.createElement("button");
			previewButton.className = "application-image-preview";
			previewButton.type = "button";
			previewButton.setAttribute("aria-label", `เปิดดูรูปภาพ: ${savedFile.display}`);

			const thumbnail = document.createElement("img");
			thumbnail.src = fileUrl;
			thumbnail.alt = "";
			thumbnail.loading = "lazy";

			const filename = document.createElement("span");
			filename.textContent = savedFile.display;
			previewButton.append(thumbnail, filename);
			previewButton.addEventListener("click", () => {
				document.querySelector("#application-image-dialog-image").src = fileUrl;
				document.querySelector("#application-image-dialog-image").alt = savedFile.display;
				document.querySelector("#application-image-dialog-caption").textContent = savedFile.display;
				imageDialog.showModal();
			});
			valueElement.replaceChildren(previewButton);
			return;
		}

		const link = document.createElement("a");
		link.href = fileUrl;
		link.target = "_blank";
		link.rel = "noopener";
		link.textContent = file.type.startsWith("image/")
			? `เปิดดูรูปภาพ: ${savedFile.display}`
			: `เปิดไฟล์: ${savedFile.display}`;
		valueElement.replaceChildren(link);
	}).catch(() => {});
}

const applicationImageDialog = document.querySelector("#application-image-dialog");
applicationImageDialog?.querySelector("#close-application-image")?.addEventListener("click", () => {
	applicationImageDialog.close();
});
applicationImageDialog?.addEventListener("click", event => {
	if (event.target === applicationImageDialog) {
		applicationImageDialog.close();
	}
});

function waitForPrintImages(container) {
	const images = [...container.querySelectorAll("img")];

	return Promise.all(images.map(image => new Promise(resolve => {
		const decodeImage = () => {
			if (typeof image.decode !== "function") {
				resolve();
				return;
			}

			image.decode().catch(() => {}).finally(resolve);
		};

		image.loading = "eager";
		if (image.complete) {
			decodeImage();
			return;
		}

		image.addEventListener("load", decodeImage, { once: true });
		image.addEventListener("error", resolve, { once: true });
	})));
}

function readApplicationDraft() {
	try {
		return JSON.parse(sessionStorage.getItem(draftStorageKey) || "{}");
	} catch {
		return {};
	}
}

async function saveApplicationStep(form) {
	const draft = readApplicationDraft();
	const previousStepData = draft[form.dataset.applicationStep] || {};
	const stepData = {};

	for (const field of form.elements) {
		if (!field.name || field.type === "button" || field.type === "submit") {
			continue;
		}

		if (field.type === "file") {
			const file = field.files[0];
			if (file) {
				const attachmentKey = `${form.dataset.applicationStep}:${field.name}`;
				try {
					await storeApplicationFile(attachmentKey, file);
				} catch {
					window.alert("ไม่สามารถเก็บไฟล์แนบในเบราว์เซอร์นี้ได้ กรุณาลองใหม่อีกครั้ง");
					return false;
				}
				stepData[field.name] = {
					value: file.name,
					display: file.name,
					type: file.type,
					attachmentKey
				};
			} else {
				stepData[field.name] = previousStepData[field.name] || { value: "", display: "" };
			}
		} else if (field.type === "checkbox") {
			stepData[field.name] = {
				value: field.checked ? field.value : "",
				display: field.checked ? "ใช่" : "ไม่"
			};
		} else if (field.tagName === "SELECT") {
			stepData[field.name] = {
				value: field.value,
				display: field.selectedOptions[0]?.textContent.trim() || ""
			};
		} else {
			stepData[field.name] = { value: field.value, display: field.value };
		}
	}

	draft[form.dataset.applicationStep] = stepData;

	try {
		sessionStorage.setItem(draftStorageKey, JSON.stringify(draft));
		return true;
	} catch {
		window.alert("ไม่สามารถเก็บข้อมูลระหว่างหน้าได้ กรุณาเปิดเว็บไซต์ผ่าน Five Server แล้วลองอีกครั้ง");
		return false;
	}
}

function restoreApplicationStep(form) {
	const stepData = readApplicationDraft()[form.dataset.applicationStep];
	if (!stepData) {
		return;
	}

	if (form.dataset.applicationStep === "applicant") {
		const faculty = form.elements.namedItem("faculty");
		if (faculty && stepData.faculty?.value) {
			faculty.value = stepData.faculty.value;
			faculty.dispatchEvent(new Event("change", { bubbles: true }));
		}
	}

	for (const field of form.elements) {
		const savedField = stepData[field.name];
		if (!field.name || !savedField || field.type === "file") {
			continue;
		}

		if (field.type === "checkbox") {
			field.checked = savedField.value === field.value;
		} else {
			field.value = savedField.value;
		}
	}
}

const applicationForm = document.querySelector("form[data-application-step]");

if (applicationForm) {
	restoreApplicationStep(applicationForm);
	applicationForm.addEventListener("submit", async event => {
		event.preventDefault();
		if (!await saveApplicationStep(applicationForm)) {
			return;
		}

		window.location.href = applicationForm.dataset.nextPage;
	});
}

document.querySelectorAll("[data-reset-application]").forEach(button => {
	button.addEventListener("click", () => {
		if (!window.confirm("ข้อมูลที่กรอกไว้ในทุกขั้นตอนจะถูกล้าง ต้องการดำเนินการต่อหรือไม่?")) {
			return;
		}

		sessionStorage.removeItem(draftStorageKey);
		void clearApplicationFiles();
		const form = button.closest("form");
		form?.reset();

		const faculty = form?.elements.namedItem("faculty");
		faculty?.dispatchEvent(new Event("change", { bubbles: true }));
	});
});

const summaryContainer = document.querySelector("#application-summary");
const paymentReceiptDetails = document.querySelector("#payment-receipt-details");
const onlinePaymentDetails = document.querySelector("#online-payment-breakdown");

const programPayments = {
	IT: {
		department: "ภาควิชาเทคโนโลยีสารสนเทศ",
		curriculum: "วิทยาศาสตรบัณฑิต (วท.บ.) 4 ปี",
		credits: "120 หน่วยกิต",
		fee: "19,000 บาท (ประมาณ)"
	},
	INE: {
		department: "ภาควิชาเทคโนโลยีสารสนเทศ",
		curriculum: "วิศวกรรมศาสตรบัณฑิต (วศ.บ.) 4 ปี หลักสูตรส่งเสริมภาษาอังกฤษ",
		credits: "125 หน่วยกิต",
		fee: "25,000 บาท (ประมาณ)"
	},
	ITI: {
		department: "ภาควิชาเทคโนโลยีสารสนเทศ",
		curriculum: "อุตสาหกรรมศาสตรบัณฑิต (อส.บ.) ต่อเนื่อง 2 ปี",
		credits: "78 หน่วยกิต",
		fee: "19,000 บาท (ประมาณ)"
	},
	INET: {
		department: "ภาควิชาเทคโนโลยีสารสนเทศ",
		curriculum: "วิศวกรรมศาสตรบัณฑิต (วศ.บ.) เทียบโอน 3 ปี",
		fee: "ไม่พบอัตราค่าเทอมในข้อมูลที่ให้มา กรุณาตรวจสอบกับภาควิชา"
	},
	IEM: {
		department: "ภาควิชาการจัดการอุตสาหกรรม (IM)",
		curriculum: "วิศวกรรมศาสตรบัณฑิต (วศ.บ.) 4 ปี หลักสูตรส่งเสริมภาษาอังกฤษ",
		credits: "145 หน่วยกิต",
		fee: "25,000 บาท"
	},
	IMT: {
		department: "ภาควิชาการจัดการอุตสาหกรรม (IM)",
		curriculum: "อุตสาหกรรมศาสตรบัณฑิต (อส.บ.) ต่อเนื่อง 2 ปี",
		credits: "84 หน่วยกิต",
		fee: "19,000 บาท/ภาคเรียน"
	},
	CA: {
		department: "ภาควิชาการออกแบบและบริหารงานก่อสร้าง",
		curriculum: "วิทยาศาสตรบัณฑิต (วท.บ.) 4 ปี",
		credits: "138 หน่วยกิต",
		fee: "19,000 บาท/ภาคเรียน (ประมาณ)"
	},
	CDM: {
		department: "ภาควิชาการออกแบบและบริหารงานก่อสร้าง",
		curriculum: "วิทยาศาสตรบัณฑิต (วท.บ.) เทียบโอน 2 ปีครึ่ง",
		credits: "92 หน่วยกิต",
		fee: "19,000 บาท/ภาคเรียน (ประมาณ)"
	},
	MM: {
		department: "ภาควิชาวิศวกรรมเกษตรเพื่ออุตสาหกรรม (AEI)",
		curriculum: "อุตสาหกรรมศาสตรบัณฑิต (อส.บ.) 4 ปี",
		credits: "148 หน่วยกิต",
		fee: "19,000 บาท/ภาคเรียน (ประมาณ)"
	},
	MMT: {
		department: "ภาควิชาวิศวกรรมเกษตรเพื่ออุตสาหกรรม (AEI)",
		curriculum: "อุตสาหกรรมศาสตรบัณฑิต (อส.บ.) เทียบโอน 2 ปีครึ่ง",
		credits: "91 หน่วยกิต",
		fee: "19,000 บาท/ภาคเรียน (ประมาณ)"
	},
	AFE: {
		department: "ภาควิชาวิศวกรรมเกษตรเพื่ออุตสาหกรรม (AEI)",
		curriculum: "วิศวกรรมศาสตรบัณฑิต (วศ.บ.) 4 ปี",
		credits: "144 หน่วยกิต",
		fee: "19,000 บาท/ภาคเรียน (ประมาณ)"
	},
	AFET: {
		department: "ภาควิชาวิศวกรรมเกษตรเพื่ออุตสาหกรรม (AEI)",
		curriculum: "วิศวกรรมศาสตรบัณฑิต (วศ.บ.) เทียบโอน 3 ปี",
		credits: "115 หน่วยกิต",
		fee: "19,000 บาท/ภาคเรียน (ประมาณ)"
	},
	"TH-4": {
		department: "ภาควิชาบริหารธุรกิจท่องเที่ยวและโรงแรม",
		curriculum: "บริหารธุรกิจบัณฑิต หลักสูตร 4 ปี",
		fee: "ไม่พบอัตราค่าเทอมในข้อมูลที่ให้มา กรุณาตรวจสอบกับภาควิชา"
	},
	"TH-2": {
		department: "ภาควิชาบริหารธุรกิจท่องเที่ยวและโรงแรม",
		curriculum: "บริหารธุรกิจบัณฑิต หลักสูตรเทียบโอน 2 ปี",
		fee: "ไม่พบอัตราค่าเทอมในข้อมูลที่ให้มา กรุณาตรวจสอบกับภาควิชา"
	},
	IBT: {
		department: "ภาควิชาบริหารธุรกิจอุตสาหกรรมและการค้า",
		curriculum: "บริหารธุรกิจบัณฑิต หลักสูตร 4 ปี",
		credits: "130 หน่วยกิต",
		schedule: "จ.-ศ. (09.00–16.00 น.)",
		fee: "19,000 บาท (เหมาจ่าย)"
	},
	IBTT: {
		department: "ภาควิชาบริหารธุรกิจอุตสาหกรรมและการค้า",
		curriculum: "บริหารธุรกิจบัณฑิต หลักสูตรเทียบโอน 3 ปี",
		credits: "100 หน่วยกิต",
		schedule: "จ.-ศ. (09.00–16.00 น.)",
		fee: "19,000 บาท (เหมาจ่าย)"
	},
	MBA: {
		department: "ภาควิชาบริหารธุรกิจอุตสาหกรรมและการค้า",
		curriculum: "บริหารธุรกิจมหาบัณฑิต (M.B.A.) 2 ปี",
		credits: "36 หน่วยกิต",
		schedule: "ภาคปกติ จ.-ศ. (09.00–16.00 น.) หรือภาคพิเศษ ส.-อา. (09.00–20.30 น.)",
		feeBySession: {
			regular: "16,000 บาท (ประมาณ)",
			special: "35,000 บาท (เหมาจ่าย)"
		}
	},
	"FOOD-SUPPLY": {
		department: "ภาควิชาเทคโนโลยีอุตสาหกรรมเกษตรและการจัดการ",
		curriculum: "วิทยาศาสตรบัณฑิต 4 ปี",
		credits: "134 หน่วยกิต",
		schedule: "จ.-ศ. (09.00–16.00 น.)",
		fee: "19,000 บาท/ภาคเรียน (เหมาจ่าย)"
	},
	"FOOD-SCIENCE": {
		department: "ภาควิชาเทคโนโลยีอุตสาหกรรมเกษตรและการจัดการ",
		curriculum: "วิทยาศาสตรบัณฑิต 4 ปี",
		credits: "128 หน่วยกิต",
		schedule: "จ.-ศ. (09.00–16.00 น.)",
		fee: "19,000 บาท/ภาคเรียน (เหมาจ่าย)"
	},
	"FOOD-ENTREPRENEUR": {
		department: "ภาควิชานวัตกรรมและเทคโนโลยีการพัฒนาผลิตภัณฑ์",
		curriculum: "วิทยาศาสตรบัณฑิต 4 ปี",
		credits: "127 หน่วยกิต",
		schedule: "จ.-ศ. (09.00–16.00 น.)",
		fee: "19,000 บาท/ภาคเรียน (เหมาจ่าย)"
	},
	"FOOD-HEALTH": {
		department: "ภาควิชานวัตกรรมและเทคโนโลยีการพัฒนาผลิตภัณฑ์",
		curriculum: "วิทยาศาสตรบัณฑิต 4 ปี",
		credits: "127 หน่วยกิต",
		schedule: "จ.-ศ. (09.00–16.00 น.)",
		fee: "19,000 บาท/ภาคเรียน (เหมาจ่าย)"
	},
	"FOOD-INDUSTRY-MSC": {
		department: "ภาควิชาเทคโนโลยีอุตสาหกรรมเกษตรและการจัดการ",
		curriculum: "วิทยาศาสตรมหาบัณฑิต 2 ปี",
		credits: "36 หน่วยกิต (3 แผนการเรียน)",
		feeBySession: {
			regular: "คิดตามหน่วยกิต ไม่เกิน 19,000 บาท/ภาคเรียน",
			special: "35,000 บาท/ภาคเรียน (เหมาจ่าย)"
		}
	}
};

if (paymentReceiptDetails || onlinePaymentDetails) {
	const draft = readApplicationDraft();
	const applicant = draft.applicant || {};
	const programCode = applicant.program?.value || "";
	const programDetails = { ...(programPayments[programCode] || {}) };
	const studySession = applicant.study_session?.value || "";
	const isSpecialSession = studySession.includes("พิเศษ");

	if (programDetails.feeBySession) {
		programDetails.fee = programDetails.feeBySession[isSpecialSession ? "special" : "regular"];
	}

	if (programCode === "MBA" && studySession) {
		programDetails.schedule = isSpecialSession
			? "ภาคพิเศษ ส.-อา. (09.00–20.30 น.)"
			: "ภาคปกติ จ.-ศ. (09.00–16.00 น.)";
	} else if (programCode === "FOOD-INDUSTRY-MSC" && studySession) {
		programDetails.schedule = isSpecialSession
			? "ภาคพิเศษ จ.-ศ. (16.00–19.00 น.) และ ส.-อา. (09.00–16.00 น.)"
			: "ภาคปกติ จ.-ศ. (09.00–16.00 น.)";
	}

	const thaiName = [
		applicant.prefix?.display,
		applicant.thai_first_name?.display,
		applicant.thai_last_name?.display
	].filter(value => value && value !== "ไม่ได้ระบุ").join(" ");
	const englishName = [
		applicant.english_first_name?.display,
		applicant.english_last_name?.display
	].filter(value => value && value !== "ไม่ได้ระบุ").join(" ");
	const rows = [
		["ชื่อ-นามสกุลผู้สมัคร", thaiName || "ไม่ได้ระบุ"],
		["ชื่อ-นามสกุล (ภาษาอังกฤษ)", englishName || "ไม่ได้ระบุ"],
		["คณะ", applicant.faculty?.display || "ไม่ได้ระบุ"],
		["ภาควิชา", programDetails.department || "ตรวจสอบภาควิชาจากสาขาที่เลือก"],
		["สาขา", applicant.program?.display || "ไม่ได้ระบุ"],
		["หลักสูตร / ระยะเวลา", programDetails.curriculum || "ตรวจสอบรายละเอียดหลักสูตรกับภาควิชา"],
		["เกณฑ์สำเร็จการศึกษา", programDetails.credits || "ไม่พบจำนวนหน่วยกิตในข้อมูลที่ให้มา"],
		["ช่วงเวลาเรียน", programDetails.schedule || "ตรวจสอบช่วงเวลาเรียนกับประกาศหลักสูตร"],
		["ค่าเทอม / รายละเอียดการเงิน", programDetails.fee || "ไม่พบอัตราค่าเทอมในข้อมูลที่ให้มา กรุณาตรวจสอบกับภาควิชา"]
	];

	if (paymentReceiptDetails) {
		for (const [label, valueText] of rows) {
			const row = document.createElement("tr");
			const labelCell = document.createElement("th");
			labelCell.scope = "row";
			labelCell.textContent = label;
			const valueCell = document.createElement("td");
			valueCell.textContent = valueText;
			row.append(labelCell, valueCell);
			paymentReceiptDetails.append(row);
		}
	}

	const paymentName = thaiName || englishName || "ไม่ได้ระบุ";
	const paymentAmount = programDetails.fee || "ไม่พบข้อมูลค่าเทอม";
	document.querySelector("#payment-applicant-name")?.replaceChildren(document.createTextNode(paymentName));
	document.querySelector("#payment-amount")?.replaceChildren(document.createTextNode(paymentAmount));

	if (onlinePaymentDetails) {
		const facultyName = applicant.faculty?.display || "ไม่ได้ระบุ";
		const departmentName = programDetails.department || "ตรวจสอบภาควิชาจากสาขาที่เลือก";
		const programName = applicant.program?.display || "ไม่ได้ระบุ";
		const onlineFields = {
			"#online-payment-name": paymentName,
			"#online-payment-faculty": facultyName,
			"#online-payment-department": departmentName,
			"#online-payment-program": programName,
			"#online-payment-amount": paymentAmount,
			"#online-qr-name": paymentName,
			"#online-qr-faculty": facultyName,
			"#online-qr-department": departmentName,
			"#online-qr-program": programName,
			"#online-qr-amount": paymentAmount
		};

		for (const [selector, valueText] of Object.entries(onlineFields)) {
			document.querySelector(selector).textContent = valueText;
		}

		const onlineRows = [
			["ชื่อ-นามสกุลผู้สมัคร", paymentName],
			["คณะ", facultyName],
			["ภาควิชา", departmentName],
			["สาขา", programName],
			["หลักสูตร / ระยะเวลา", programDetails.curriculum || "ตรวจสอบรายละเอียดหลักสูตรกับภาควิชา"],
			["เกณฑ์สำเร็จการศึกษา", programDetails.credits || "ไม่พบจำนวนหน่วยกิตในข้อมูลที่ให้มา"],
			["ช่วงเวลาเรียน", programDetails.schedule || "ตรวจสอบช่วงเวลาเรียนกับประกาศหลักสูตร"],
			["ค่าเทอมที่ต้องชำระ", paymentAmount]
		];

		for (const [label, valueText] of onlineRows) {
			const row = document.createElement("tr");
			const labelCell = document.createElement("th");
			labelCell.scope = "row";
			labelCell.textContent = label;
			const valueCell = document.createElement("td");
			valueCell.textContent = valueText;
			row.append(labelCell, valueCell);
			if (label === "ค่าเทอมที่ต้องชำระ") {
				row.className = "online-payment-total";
			}
			onlinePaymentDetails.append(row);
		}

		const startOnlinePaymentButton = document.querySelector("#start-online-payment");
		const onlineQrPanel = document.querySelector("#online-qr-panel");
		startOnlinePaymentButton.addEventListener("click", () => {
			onlineQrPanel.hidden = false;
			startOnlinePaymentButton.setAttribute("aria-expanded", "true");
			document.querySelector("#online-qr-title").focus();
		});
	}

	if (paymentReceiptDetails) {
	const barcodeRow = document.createElement("tr");
	barcodeRow.className = "bank-barcode-row";
	const barcodeLabel = document.createElement("th");
	barcodeLabel.scope = "row";
	barcodeLabel.textContent = "บาร์โค้ดชำระเงินผ่านธนาคาร (จำลอง)";
	const barcodeCell = document.createElement("td");
	const barcode = document.createElement("div");
	barcode.className = "bank-barcode";
	barcode.setAttribute("role", "img");
	barcode.setAttribute("aria-label", "บาร์โค้ดจำลอง ไม่สามารถใช้ชำระเงินจริงได้");
	const barcodeSeed = `${programCode}|${paymentName}|${paymentAmount}`;

	for (let index = 0; index < 96; index += 1) {
		const seedCode = barcodeSeed.charCodeAt(index % barcodeSeed.length);
		const bar = document.createElement("span");
		bar.style.width = `${1 + ((seedCode + index * 7) % 3)}px`;
		if ((seedCode + index * 11) % 2 === 0) {
			bar.className = "is-dark";
		}
		barcode.append(bar);
	}

	const barcodeCaption = document.createElement("p");
	barcodeCaption.className = "bank-barcode-caption";
	barcodeCaption.textContent = "ใช้สำหรับแสดงตัวอย่างเท่านั้น ไม่สามารถสแกนชำระเงินจริงได้";
	barcodeCell.append(barcode, barcodeCaption);
	barcodeRow.append(barcodeLabel, barcodeCell);
	paymentReceiptDetails.append(barcodeRow);
	}

	const bankReceipt = document.querySelector(".payment-receipt");
	const printBankReceipt = async () => {
		await waitForPrintImages(bankReceipt);
		window.print();
	};
	document.querySelector("#print-payment-receipt")?.addEventListener("click", printBankReceipt);
	document.querySelector("#download-bank-payment-pdf")?.addEventListener("click", async () => {
		await waitForPrintImages(bankReceipt);
		const originalTitle = document.title;
		const safeApplicantName = paymentName.replace(/[\\/:*?"<>|]/g, "-");
		document.title = `ใบชำระเงิน-${safeApplicantName}`;
		window.print();
		document.title = originalTitle;
	});
	if (new URLSearchParams(window.location.search).get("print") === "bank") {
		if (document.readyState === "complete") {
			window.setTimeout(() => void printBankReceipt(), 0);
		} else {
			window.addEventListener("load", () => void printBankReceipt(), { once: true });
		}
	}

	const successScreen = document.querySelector("#payment-success-screen");
	document.querySelectorAll("#online-complete-payment").forEach(button => {
		button.addEventListener("click", () => {
			button.disabled = true;
			successScreen.hidden = false;
			document.querySelector("#payment-success-title").focus();

			let secondsRemaining = 3;
			const countdown = document.querySelector("#payment-countdown");
			const timer = window.setInterval(() => {
				secondsRemaining -= 1;
				countdown.textContent = String(secondsRemaining);

				if (secondsRemaining <= 0) {
					window.clearInterval(timer);
					window.location.href = "../index.html";
				}
			}, 1000);
		});
	});
}

if (summaryContainer) {
	const draft = readApplicationDraft();
	const sections = [
		{
			title: "ข้อมูลการศึกษาเดิม",
			step: "education",
			fields: [
				["previous_school", "โรงเรียน / สถาบันการศึกษาเดิม"],
				["school_province", "จังหวัดของโรงเรียนเดิม"],
				["qualification", "วุฒิการศึกษา"],
				["study_track", "สายการเรียน / สาขาวิชา"],
				["gpax", "เกรดเฉลี่ยสะสม (GPAX)"],
				["graduation_year", "ปีการศึกษาที่สำเร็จ"],
				["transcript", "ใบแสดงผลการเรียน (ปพ.1 / Transcript)"],
				["enrollment_certificate", "ใบรับรองสถานะการศึกษา (ปพ.7)"]
			]
		},
		{
			title: "ข้อมูลการสมัครและผู้สมัคร",
			step: "applicant",
			fields: [
				["faculty", "คณะ"],
				["program", "สาขาวิชา / หลักสูตร"],
				["admission_round", "โครงการ / รอบการรับสมัคร"],
				["study_session", "ภาคการศึกษา"],
				["prefix", "คำนำหน้าชื่อ"],
				["thai_first_name", "ชื่อ (ภาษาไทย)"],
				["thai_last_name", "นามสกุล (ภาษาไทย)"],
				["english_first_name", "ชื่อ (ภาษาอังกฤษ)"],
				["english_last_name", "นามสกุล (ภาษาอังกฤษ)"],
				["identity_type", "ประเภทเอกสารประจำตัว"],
				["identity_number", "เลขประจำตัวประชาชน / เลขพาสปอร์ต"],
				["birth_date", "วัน / เดือน / ปีเกิด"],
				["nationality", "สัญชาติ"],
				["ethnicity", "เชื้อชาติ"],
				["religion", "ศาสนา"],
				["applicant_phone", "เบอร์โทรศัพท์มือถือ"],
				["applicant_email", "อีเมล"],
				["house_number", "บ้านเลขที่"],
				["village_number", "หมู่"],
				["road", "ถนน"],
				["subdistrict", "ตำบล / แขวง"],
				["district", "อำเภอ / เขต"],
				["province", "จังหวัด"],
				["postal_code", "รหัสไปรษณีย์"]
			]
		},
		{
			title: "ข้อมูลผู้ปกครอง",
			step: "guardian",
			fields: [
				["guardian_relationship", "ความสัมพันธ์กับผู้สมัคร"],
				["guardian_prefix", "คำนำหน้าชื่อ"],
				["guardian_first_name", "ชื่อผู้ปกครอง"],
				["guardian_last_name", "นามสกุลผู้ปกครอง"],
				["guardian_phone", "เบอร์โทรศัพท์มือถือ"],
				["guardian_alternative_contact", "เบอร์สำรอง / Line ID"],
				["guardian_email", "อีเมล"],
				["guardian_occupation", "อาชีพ"],
				["guardian_workplace", "สถานที่ทำงาน"],
				["guardian_same_address", "ที่อยู่เดียวกับผู้สมัคร"],
				["guardian_address", "ที่อยู่ผู้ปกครอง"]
			]
		}
	];

	for (const sectionData of sections) {
		const section = document.createElement("section");
		section.className = "summary-section";

		const heading = document.createElement("h2");
		heading.textContent = sectionData.title;
		section.append(heading);

		const list = document.createElement("dl");
		list.className = "summary-list";
		const stepData = draft[sectionData.step] || {};

		for (const [name, label] of sectionData.fields) {
			const row = document.createElement("div");
			row.className = "summary-row";

			const term = document.createElement("dt");
			term.textContent = label;
			const value = document.createElement("dd");
			const savedField = stepData[name];

			if (name === "guardian_address" && stepData.guardian_same_address?.value === "yes") {
				value.textContent = "ใช้ที่อยู่เดียวกับผู้สมัคร";
			} else {
				value.textContent = savedField?.display || "ไม่ได้ระบุ";
			}
			renderApplicationFileLink(value, savedField);

			row.append(term, value);
			list.append(row);
		}

		section.append(list);
		summaryContainer.append(section);
	}

	const clearButton = document.querySelector("#clear-application");
	clearButton?.addEventListener("click", () => {
		sessionStorage.removeItem(draftStorageKey);
		void clearApplicationFiles();
		window.location.href = "apply.html";
	});
}
