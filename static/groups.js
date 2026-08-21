document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('g-search');
  const typeFilter = document.getElementById('g-type-filter');
  const groupCards = Array.from(document.querySelectorAll('.sangha-group-card'));
  const emptyFilterState = document.getElementById('group-empty-filter');
  const visibleCountLabel = document.getElementById('groups-visible-count');
  const coverShells = Array.from(document.querySelectorAll('[data-cover-shell]'));
  const photoInput = document.getElementById('group-photo-input');
  const photoPreview = document.getElementById('group-photo-preview');
  const photoName = document.getElementById('group-photo-name');
  const destinationInput = document.getElementById('destination-input');
  const groupNameInput = document.getElementById('group-name-input');
  const destinationUseButtons = Array.from(document.querySelectorAll('[data-destination-use]'));
  const destinationExploreButtons = Array.from(document.querySelectorAll('[data-destination-explore]'));
  const destinationDeskStatus = document.getElementById('destination-desk-status');
  const storyButtons = Array.from(document.querySelectorAll('[data-story-target]'));
  const jumpLinks = Array.from(document.querySelectorAll('[data-group-jump]'));
  const detailModal = document.getElementById('group-detail-modal');
  const detailClose = document.getElementById('group-detail-close');
  const detailCover = document.getElementById('group-detail-cover');
  const detailCoverImage = document.getElementById('group-detail-cover-img');
  const detailType = document.getElementById('group-detail-type');
  const detailTitle = document.getElementById('group-detail-title');
  const detailDestination = document.getElementById('group-detail-destination');
  const detailOwner = document.getElementById('group-detail-owner');
  const detailCapacity = document.getElementById('group-detail-capacity');
  const detailMembership = document.getElementById('group-detail-membership');
  const detailDescription = document.getElementById('group-detail-description');
  const detailLocationPanel = document.getElementById('group-detail-location-panel');
  const detailPrivacyPanel = document.getElementById('group-detail-privacy-panel');
  const detailLocations = document.getElementById('group-detail-locations');
  const detailActions = document.getElementById('group-detail-actions');
  const jumpTargets = {
    create: document.getElementById('group-create-panel'),
    explore: document.getElementById('groups-explore-panel'),
  };
  const hero = document.getElementById('hero-section');
  const heroBg = document.getElementById('groups-hero-bg');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const defaultPreviewImage = photoPreview ? (photoPreview.dataset.defaultImage || '') : '';
  let previewUrl = '';
  let lastFocusedCard = null;

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value || '';
    return div.innerHTML;
  }

  // Make key groups sections visible even if the shared reveal observer
  // misses them or another page script fails earlier.
  document.querySelectorAll('.reveal').forEach((element) => {
    element.classList.add('active', 'visible');
  });

  function focusSection(sectionKey) {
    jumpLinks.forEach((link) => {
      link.classList.toggle('active', link.dataset.groupJump === sectionKey);
    });
  }

  function pulseTarget(sectionKey) {
    const target = jumpTargets[sectionKey];
    if (!target) return;
    target.classList.add('section-focus');
    window.setTimeout(() => target.classList.remove('section-focus'), 1800);
  }

  function syncSectionFromHash() {
    if (window.location.hash === '#group-create-panel') {
      focusSection('create');
      return;
    }

    if (window.location.hash === '#groups-explore-panel' || window.location.hash === '#groups-discover') {
      focusSection('explore');
      return;
    }

    focusSection('create');
  }

  function applyFilters() {
    if (!searchInput || !typeFilter) return;

    const query = searchInput.value.trim().toLowerCase();
    const type = typeFilter.value;
    let matchedCount = 0;

    groupCards.forEach((card) => {
      const matchQuery = [card.dataset.name, card.dataset.dest, card.dataset.owner]
        .filter(Boolean)
        .some((value) => value.includes(query));
      const matchType = type === 'All' || card.dataset.type === type;
      const visible = matchQuery && matchType;
      card.classList.toggle('hidden', !visible);
      if (visible) matchedCount += 1;
    });

    if (visibleCountLabel) {
      visibleCountLabel.textContent = String(matchedCount);
    }

    if (emptyFilterState) {
      emptyFilterState.classList.toggle('hidden', matchedCount > 0 || (query === '' && type === 'All'));
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
  }

  if (typeFilter) {
    typeFilter.addEventListener('change', applyFilters);
  }

  function bindCoverFallbacks() {
    coverShells.forEach((shell) => {
      const image = shell.querySelector('img');
      const activateFallback = () => shell.classList.add('is-fallback');

      if (!image || !image.getAttribute('src')) {
        activateFallback();
        return;
      }

      image.addEventListener('error', activateFallback, { once: true });

      if (image.complete && image.naturalWidth === 0) {
        activateFallback();
      }
    });
  }

  function closeDetailModal() {
    if (!detailModal) return;
    detailModal.classList.add('hidden');
    detailModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sangha-modal-open');
    if (lastFocusedCard) {
      lastFocusedCard.focus();
    }
  }

  function renderLocationItems(locations) {
    if (!detailLocations) return;
    detailLocations.innerHTML = '';

    if (!locations || locations.length === 0) {
      detailLocations.innerHTML = `
        <div class="sangha-location-empty">
          <strong>No member has shared a live location yet.</strong>
          <p>The location list will appear here once teammates update their safety location.</p>
        </div>`;
      return;
    }

    detailLocations.innerHTML = locations.map((entry) => {
      const label = escapeHtml(entry.location?.label || 'Location unavailable');
      const mapsUrl = entry.location?.maps_url;
      const locationMarkup = mapsUrl
        ? `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener">${label}</a>`
        : `<span>${label}</span>`;

      return `
        <div class="sangha-location-item">
          <div>
            <strong>${escapeHtml(entry.username)}</strong>
            <small>${escapeHtml(entry.role)}</small>
          </div>
          <div class="sangha-location-item-link">${locationMarkup}</div>
        </div>`;
    }).join('');
  }

  function renderDetailActions(card) {
    if (!detailActions) return;
    const actions = card.querySelector('.sangha-group-actions');
    detailActions.innerHTML = actions ? actions.innerHTML : '';
  }

  function applyDetailCover(details) {
    if (!detailCover || !detailCoverImage) return;
    detailCover.className = 'sangha-modal-media sangha-cover-shell';
    if (details.cover_theme) {
      detailCover.classList.add(`sangha-cover-theme-${details.cover_theme}`);
    }
    if (details.cover_url) {
      detailCover.classList.add('has-cover');
      detailCoverImage.src = details.cover_url;
      detailCoverImage.alt = `${details.name} cover`;
      detailCoverImage.hidden = false;
      detailCoverImage.onerror = () => {
        detailCoverImage.hidden = true;
        detailCover.classList.add('is-fallback');
      };
    } else {
      detailCoverImage.removeAttribute('src');
      detailCoverImage.alt = '';
      detailCoverImage.hidden = true;
      detailCover.classList.add('is-fallback');
    }
  }

  function renderGroupDetails(card, details) {
    if (!detailModal) return;

    applyDetailCover(details);
    if (detailType) {
      detailType.textContent = details.type || 'Group';
      detailType.className = `badge ${details.type === 'Public' ? 'badge-tt' : 'badge-ast'}`;
    }
    if (detailTitle) detailTitle.textContent = details.name || 'Travel Circle';
    if (detailDestination) detailDestination.textContent = details.destination || 'Across India';
    if (detailOwner) detailOwner.textContent = `Led by ${details.owner_name || 'Unknown'}`;
    if (detailCapacity) detailCapacity.textContent = `${details.member_count || 0} / ${details.max_members || 0} members`;
    if (detailMembership) {
      detailMembership.textContent = details.is_member
        ? 'You are an approved member'
        : 'Join this group to unlock teammate locations';
    }
    if (detailDescription) {
      detailDescription.textContent = details.description || 'No trip brief yet. This group has not added a longer description.';
    }

    renderLocationItems(details.member_locations || []);
    if (detailLocationPanel) {
      detailLocationPanel.classList.toggle('hidden', !details.is_member);
    }
    if (detailPrivacyPanel) {
      detailPrivacyPanel.classList.toggle('hidden', !!details.is_member);
    }

    renderDetailActions(card);
  }

  async function openGroupDetails(card) {
    if (!detailModal || !card?.dataset.groupId) return;

    lastFocusedCard = card;
    detailModal.classList.remove('hidden');
    detailModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sangha-modal-open');
    renderDetailActions(card);
    if (detailDescription) detailDescription.textContent = 'Loading group details...';
    if (detailLocations) detailLocations.innerHTML = '';

    try {
      const response = await fetch(`/api/tt/groups/${card.dataset.groupId}`);
      const details = await response.json();
      if (!response.ok) {
        throw new Error(details.error || 'Could not load group details.');
      }
      renderGroupDetails(card, details);
    } catch (error) {
      if (detailDescription) {
        detailDescription.textContent = error.message || 'Could not load group details right now.';
      }
      if (detailLocationPanel) detailLocationPanel.classList.add('hidden');
      if (detailPrivacyPanel) detailPrivacyPanel.classList.remove('hidden');
    }
  }

  function setPreviewBackdrop(imageUrl) {
    if (!photoPreview) return;

    if (imageUrl) {
      photoPreview.style.backgroundImage =
        `linear-gradient(180deg, rgba(8, 8, 10, 0.08), rgba(8, 8, 10, 0.78)), url('${imageUrl}')`;
      return;
    }

    photoPreview.style.backgroundImage = '';
  }

  function updatePreview(file) {
    if (!photoPreview || !photoName) return;

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = '';
    }

    if (!file) {
      setPreviewBackdrop(defaultPreviewImage);
      photoName.textContent = photoName.dataset.defaultLabel || '';
      return;
    }

    previewUrl = URL.createObjectURL(file);
    setPreviewBackdrop(previewUrl);
    photoName.textContent = file.name;
  }

  if (photoInput) {
    photoInput.addEventListener('change', () => {
      const file = photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
      updatePreview(file);
    });
  }

  destinationUseButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const destinationName = button.dataset.destinationUse || '';
      const previewImage = button.dataset.previewImage || defaultPreviewImage;
      if (destinationInput) {
        destinationInput.value = destinationName;
      }
      if (destinationDeskStatus) {
        destinationDeskStatus.textContent = `${destinationName} loaded into Create Circle. Add a group name and trip brief, then publish it.`;
      }
      if (!photoInput || !photoInput.files || photoInput.files.length === 0) {
        setPreviewBackdrop(previewImage);
      }
      focusSection('create');
      pulseTarget('create');
      jumpTargets.create?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      groupNameInput?.focus();
    });
  });

  destinationExploreButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const destinationName = button.dataset.destinationExplore || '';
      if (searchInput) {
        searchInput.value = destinationName;
      }
      if (typeFilter && typeFilter.value !== 'All') {
        typeFilter.value = 'All';
      }
      if (destinationDeskStatus) {
        destinationDeskStatus.textContent = `Showing live circles that match ${destinationName}. Clear the search to browse everything again.`;
      }
      applyFilters();
      focusSection('explore');
      pulseTarget('explore');
      jumpTargets.explore?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      searchInput?.focus();
    });
  });

  storyButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.storyTarget;
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;

      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('story-focus');
      window.setTimeout(() => target.classList.remove('story-focus'), 1800);
    });
  });

  groupCards.forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('.sangha-group-actions a')) {
        return;
      }
      openGroupDetails(card);
    });

    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        if (event.target.closest('.sangha-group-actions a')) {
          return;
        }
        event.preventDefault();
        openGroupDetails(card);
      }
    });
  });

  if (detailModal) {
    detailModal.addEventListener('click', (event) => {
      if (event.target === detailModal) {
        closeDetailModal();
      }
    });
  }

  if (detailClose) {
    detailClose.addEventListener('click', closeDetailModal);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && detailModal && !detailModal.classList.contains('hidden')) {
      closeDetailModal();
    }
  });

  jumpLinks.forEach((link) => {
    link.addEventListener('click', () => {
      const sectionKey = link.dataset.groupJump;
      if (!sectionKey) return;
      focusSection(sectionKey);
      pulseTarget(sectionKey);
    });
  });

  function applySearchFromQueryString() {
    const requested = new URLSearchParams(window.location.search).get('q');
    if (!requested || !searchInput) return;
    searchInput.value = requested;
    if (typeFilter) typeFilter.value = 'All';
    focusSection('explore');
    pulseTarget('explore');
    jumpTargets.explore?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.addEventListener('hashchange', syncSectionFromHash);
  syncSectionFromHash();
  bindCoverFallbacks();
  setPreviewBackdrop(defaultPreviewImage);
  applySearchFromQueryString();
  applyFilters();

  if (hero && heroBg && !prefersReducedMotion) {
    hero.addEventListener('mousemove', (event) => {
      const rect = hero.getBoundingClientRect();
      const offsetX = (event.clientX - rect.left - rect.width / 2) / rect.width;
      const offsetY = (event.clientY - rect.top - rect.height / 2) / rect.height;
      heroBg.style.transform = `scale(1.09) translate3d(${offsetX * 18}px, ${offsetY * 12}px, 0)`;
    });

    hero.addEventListener('mouseleave', () => {
      heroBg.style.transform = '';
    });
  }
});
