from styles.styler import COLORS

component_adinfo = """
    class BtnCellRenderer {
        init(params) {
            console.log('params_other', params);
            this.params = params;
            this.eGui = document.createElement('div');
            this.eGui.innerHTML = `
            <div style="display: flex; flex-direction: row; align-items: center; gap: 1em;">
                <div style="width: 2.5em; height: 2.5em">
                    <img src="${this.params.value.thumbnail_url}" style="width: 100%; height: 100%; border-radius: 4px">
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.25em;">
                    <span style="font-weight: bold; line-height: 1em">${this.params.value.ad_name}</span>
                    <span style="opacity: 0.67;font-size: 0.8em; line-height: 1em">${this.params.value.adset_name}</span>
                </div>
            </div>
            `;
        }

        getGui() {
            return this.eGui;
        }

        refresh() {
            return true;
        }
    }
"""

component_adinfo_byad = """
    class BtnCellRenderer {
        init(params) {
            console.log('params_byad', params);
            this.params = params;
            this.eGui = document.createElement('div');
            this.eGui.innerHTML = `
            <div style="display: flex; flex-direction: row; align-items: center; gap: 1em;">
                <div style="width: 2.5em; height: 2.5em">
                    <img src="${this.params.value.thumbnail_url}" style="width: 100%; height: 100%; border-radius: 4px">
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.25em;">
                    <span style="font-weight: bold; line-height: 1.25em">${this.params.value.ad_name}</span>
                </div>
            </div>
            `;
        }

        getGui() {
            return this.eGui;
        }

        refresh() {
            return true;
        }
    }
"""