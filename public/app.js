(() => {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) {
    document.documentElement.classList.add('is-touch');
  }

  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
  }

  const carousel = document.querySelector('[data-carousel]');
  if (carousel) {
    const track = carousel.querySelector('.carousel-track');
    const items = carousel.querySelectorAll('.testimonial');
    const prev = carousel.querySelector('[data-prev]');
    const next = carousel.querySelector('[data-next]');
    let index = 0;

    const update = () => {
      track.style.transform = `translateX(-${index * 100}%)`;
    };

    const goNext = () => {
      index = (index + 1) % items.length;
      update();
    };

    const goPrev = () => {
      index = (index - 1 + items.length) % items.length;
      update();
    };

    if (prev && next) {
      prev.addEventListener('click', goPrev);
      next.addEventListener('click', goNext);
    }

    setInterval(goNext, 6000);
  }

  const lightbox = document.querySelector('.lightbox');
  if (lightbox) {
    const lightboxImage = lightbox.querySelector('img');
    document.querySelectorAll('[data-lightbox]').forEach((item) => {
      item.addEventListener('click', () => {
        const src = item.getAttribute('data-lightbox');
        lightboxImage.src = src;
        lightbox.classList.add('active');
      });
    });

    lightbox.addEventListener('click', () => {
      lightbox.classList.remove('active');
    });
  }

  const calendarRoot = document.querySelector('[data-calendar]');
  if (calendarRoot) {
    const serviceId = calendarRoot.getAttribute('data-service-id');
    const selectedDateInput = document.querySelector('input[name="date"]');
    const selectedTimeInput = document.querySelector('input[name="time"]');
    const timeslotContainer = document.querySelector('[data-timeslots]');
    const monthLabel = calendarRoot.querySelector('[data-month-label]');
    const prevBtn = calendarRoot.querySelector('[data-prev-month]');
    const nextBtn = calendarRoot.querySelector('[data-next-month]');

    let currentMonth = new Date();
    currentMonth.setDate(1);

    const fetchAvailability = async (monthKey) => {
      const response = await fetch(`/api/availability?serviceId=${serviceId}&month=${monthKey}`);
      return response.json();
    };

    const render = async () => {
      const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      const data = await fetchAvailability(monthKey);
      const startTimes = data.startTimes || [];
      const blocked = new Set(data.blocks.map((b) => `${b.date}|${b.time}`));
      const booked = new Set(data.bookings.map((b) => `${b.date}|${b.time}`));

      const grid = calendarRoot.querySelector('.calendar-grid');
      grid.innerHTML = '';
      const startDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
      const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
      monthLabel.textContent = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      for (let i = 0; i < startDay; i += 1) {
        const spacer = document.createElement('div');
        grid.appendChild(spacer);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
        const dateKey = date.toISOString().slice(0, 10);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'calendar-day';
        cell.textContent = day;

        if (date < today) {
          cell.classList.add('disabled');
          cell.disabled = true;
        }

        const hasAvailable = startTimes.some((time) => {
          const key = `${dateKey}|${time}`;
          return !blocked.has(key) && !booked.has(key);
        });

        if (!hasAvailable) {
          cell.classList.add('disabled');
          cell.disabled = true;
        }

        cell.addEventListener('click', () => {
          calendarRoot.querySelectorAll('.calendar-day').forEach((el) => el.classList.remove('selected'));
          cell.classList.add('selected');
          selectedDateInput.value = dateKey;
          timeslotContainer.innerHTML = '';

          startTimes.forEach((time) => {
            const slotKey = `${dateKey}|${time}`;
            const slot = document.createElement('button');
            slot.type = 'button';
            slot.className = 'timeslot';
            slot.textContent = time;
            if (blocked.has(slotKey) || booked.has(slotKey)) {
              slot.disabled = true;
              slot.classList.add('disabled');
            }
            slot.addEventListener('click', () => {
              timeslotContainer.querySelectorAll('.timeslot').forEach((el) => el.classList.remove('selected'));
              slot.classList.add('selected');
              selectedTimeInput.value = time;
            });
            timeslotContainer.appendChild(slot);
          });
        });

        grid.appendChild(cell);
      }
    };

    prevBtn.addEventListener('click', () => {
      currentMonth.setMonth(currentMonth.getMonth() - 1);
      render();
    });

    nextBtn.addEventListener('click', () => {
      currentMonth.setMonth(currentMonth.getMonth() + 1);
      render();
    });

    render();
  }

  const bookingForm = document.querySelector('[data-booking-form]');
  if (bookingForm) {
    bookingForm.addEventListener('submit', (event) => {
      const date = bookingForm.querySelector('input[name=\"date\"]').value;
      const time = bookingForm.querySelector('input[name=\"time\"]').value;
      if (!date || !time) {
        event.preventDefault();
        alert('Please select a date and time before submitting.');
      }
    });
  }

  const settingsForm = document.querySelector('[data-settings-form]');
  if (settingsForm) {
    const addButtons = settingsForm.querySelectorAll('[data-add-row]');
    addButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.getAttribute('data-target');
        const list = settingsForm.querySelector(`[data-list="${target}"]`);
        if (!list) return;

        if (target === 'lodging' || target === 'food') {
          const row = document.createElement('div');
          row.className = 'list-row';
          row.innerHTML = `
            <input name="${target === 'lodging' ? 'lodgingName' : 'foodName'}" placeholder="Name" />
            <input name="${target === 'lodging' ? 'lodgingDescription' : 'foodDescription'}" placeholder="Short description" />
            <input name="${target === 'lodging' ? 'lodgingUrl' : 'foodUrl'}" placeholder="https://" />
            <button class="button secondary" type="button" data-remove>Remove</button>
          `;
          list.appendChild(row);
        }

        if (target === 'camping') {
          const row = document.createElement('div');
          row.className = 'list-row compact';
          row.innerHTML = `
            <input name="campingItem" placeholder="Camping location" />
            <button class="button secondary" type="button" data-remove>Remove</button>
          `;
          list.appendChild(row);
        }
      });
    });

    settingsForm.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-remove]');
      if (removeButton) {
        const row = removeButton.closest('.list-row');
        if (row) {
          row.remove();
        }
      }
    });
  }

  const contactSuccess = document.querySelector('[data-contact-success]');
  if (contactSuccess) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('contact') === 'success') {
      contactSuccess.classList.add('notice');
      contactSuccess.textContent = 'Thanks for reaching out. We will reply shortly.';
    }
  }

})();
