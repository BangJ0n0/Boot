(function () {
  const revealText = (node, visible) => {
    const full = node.dataset.secret || "-";
    const masked = node.dataset.masked || full;
    node.textContent = visible ? full : masked;
  };

  const setAuthFeedback = (form, message, type = "error") => {
    const feedback = form.parentElement?.querySelector("[data-auth-feedback]");
    const textNode = feedback?.querySelector("[data-auth-feedback-text]");
    if (!feedback || !textNode) return;
    feedback.hidden = !message;
    feedback.classList.remove("flash-error", "flash-success");
    feedback.classList.add(type === "success" ? "flash-success" : "flash-error");
    feedback.querySelector("i").className = `fa-solid ${
      type === "success" ? "fa-circle-check" : "fa-circle-exclamation"
    }`;
    textNode.textContent = message || "";
  };

  const normalizeFormPayload = (form) => {
    const payload = {};
    new FormData(form).forEach((value, key) => {
      payload[key] = typeof value === "string" ? value.trim() : value;
    });
    return payload;
  };

  const validateAuthForm = (form, mode, payload) => {
    if (mode === "register") {
      if (!payload.name || !payload.username || !payload.email || !payload.password) {
        return "semua field register wajib diisi.";
      }
      if (String(payload.password).length < 6) {
        return "password minimal 6 karakter.";
      }
    }

    if (mode === "login") {
      if (!payload.identifier || !payload.password) {
        return "identifier dan password wajib diisi.";
      }
    }

    return "";
  };

  document.querySelectorAll("[data-secret]").forEach((node) => {
    revealText(node, false);
  });

  document.querySelectorAll("[data-secret-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.secretToggle;
      const visible = button.dataset.secretVisible === "true";
      const nextVisible = !visible;
      document.querySelectorAll(`[data-secret-group="${targetId}"] [data-secret]`).forEach((node) => {
        revealText(node, nextVisible);
      });
      button.dataset.secretVisible = String(nextVisible);
      button.innerHTML = nextVisible
        ? '<i class="fa-solid fa-eye-slash"></i> sensor'
        : '<i class="fa-solid fa-eye"></i> buka';
    });
  });

  document.querySelectorAll("[data-upload-input]").forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      const hiddenSelector = input.dataset.uploadHidden;
      const previewSelector = input.dataset.uploadPreview;
      const hidden = hiddenSelector ? document.querySelector(hiddenSelector) : null;
      const preview = previewSelector ? document.querySelector(previewSelector) : null;
      if (!file || !hidden) return;
      const reader = new FileReader();
      reader.onload = () => {
        hidden.value = String(reader.result || "");
        if (preview) preview.src = hidden.value;
      };
      reader.readAsDataURL(file);
    });
  });

  document.querySelectorAll("[data-auth-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const mode = form.dataset.authForm || "login";
      const payload = normalizeFormPayload(form);
      const validationMessage = validateAuthForm(form, mode, payload);
      if (validationMessage) {
        setAuthFeedback(form, validationMessage, "error");
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      const originalLabel = submitButton?.innerHTML || "";
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> memproses...';
      }
      setAuthFeedback(form, "");

      try {
        const response = await fetch(form.action, {
          method: form.method || "post",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest"
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
          setAuthFeedback(form, result.message || "permintaan auth gagal diproses.", "error");
          return;
        }

        setAuthFeedback(form, result.message || "berhasil diproses.", "success");
        window.location.href = result.redirectTo || (mode === "register" ? "/login" : "/dashboard");
      } catch (error) {
        setAuthFeedback(form, "koneksi ke server auth gagal. coba lagi.", "error");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.innerHTML = originalLabel;
        }
      }
    });
  });
})();
